// ========================================
// NETLIFY FUNCTION: Webhook Pagamento (EvoPay)
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
    const userId = event.queryStringParameters?.u; // Resgatado da URL customizada
    const { status, amount } = webhookData;

    if (status !== 'COMPLETED' || !userId || !amount) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Status ignorado ou dados incompletos' }) };
    }

    // Busca o depósito pendente correspondente ao usuário e valor
    const depositsSnapshot = await db.collection('deposits')
      .where('userId', '==', userId)
      .where('amount', '==', parseFloat(amount))
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (depositsSnapshot.empty) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Depósito não encontrado ou já processado' }) };
    }

    const depositDoc = depositsSnapshot.docs[0];

    // Transação Firestore idêntica à sua original para garantir consistência
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
        description: 'Depósito Aprovado (EvoPay)',
        transactionId: depositDoc.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error("Erro no Webhook:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
