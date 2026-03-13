// ========================================
// NETLIFY FUNCTION: Webhook Pagamento
// ========================================
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  });
}
const db = admin.firestore();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const webhookData = JSON.parse(event.body);
    
    const status = webhookData.status; 
    const transactionId = webhookData.id || webhookData.transactionId;
    const amount = webhookData.amount;

    if (status !== 'COMPLETED') {
      return { statusCode: 200, body: JSON.stringify({ message: 'Status ignorado' }) };
    }

    const depositsSnapshot = await db.collection('deposits')
      .where('transactionId', '==', transactionId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (depositsSnapshot.empty) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Depósito não encontrado ou já processado' }) };
    }

    const depositDoc = depositsSnapshot.docs[0];
    const depositData = depositDoc.data();
    const userId = depositData.userId;

    await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) throw new Error('Usuário não encontrado');

      // Atualiza saldo do usuário
      transaction.update(userRef, {
        balance: admin.firestore.FieldValue.increment(amount),
        totalEarned: admin.firestore.FieldValue.increment(amount)
      });

      // Atualiza status do depósito
      transaction.update(depositDoc.ref, {
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Registra no histórico de transações
      const txRef = userRef.collection('transactions').doc();
      transaction.set(txRef, {
        type: 'deposit',
        amount: amount,
        status: 'completed',
        description: 'Depósito Aprovado',
        transactionId: transactionId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
