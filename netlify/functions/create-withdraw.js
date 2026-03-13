// ========================================
// NETLIFY FUNCTION: Criar Solicitação Saque (Pendente)
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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  try {
    const { userId, amount, pixKey, pixType, ownerName, ownerDocument } = JSON.parse(event.body);

    if (!userId || !amount || !pixKey || !pixType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId, amount, pixKey e pixType são obrigatórios' }) };
    }

    if (amount < 35) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Saque mínimo é R$ 35,00' }) };
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Usuário não encontrado' }) };

    const balance = userDoc.data().balance || 0;
    const totalWithFee = amount * 1.1; // Exemplo de taxa retida

    if (balance < totalWithFee) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Saldo insuficiente' }) };
    }

    // Processamento em Banco de Dados via Batch ou Transaction para garantir consistência
    const batch = db.batch();

    // 1. Desconta Saldo
    batch.update(userRef, {
      balance: admin.firestore.FieldValue.increment(-totalWithFee),
      totalWithdrawn: admin.firestore.FieldValue.increment(amount)
    });

    // 2. Salva saque como Processing
    const withdrawalRef = userRef.collection('withdrawals').doc();
    batch.set(withdrawalRef, {
      amount: parseFloat(amount),
      fee: amount * 0.1,
      netAmount: amount * 0.9,
      pixKey,
      pixType,
      ownerName: ownerName || '',
      ownerDocument: ownerDocument || '',
      status: 'processing', // Aguardando Admin
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Salva Registro de Transação
    const transactionRef = userRef.collection('transactions').doc();
    batch.set(transactionRef, {
      type: 'withdrawal',
      amount: parseFloat(amount),
      status: 'processing',
      description: `Saque solicitado (${pixType})`,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        withdrawalId: withdrawalRef.id,
        message: 'Saque solicitado. Aguardando aprovação.'
      })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Falha ao processar saque', details: error.message }) };
  }
};
