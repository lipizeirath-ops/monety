// ========================================
// NETLIFY FUNCTION: Criar Pagamento PIX (EvoPay)
// ========================================
const axios = require('axios');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  }
}

const db = admin.apps.length ? admin.firestore() : null;

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
    if (!db) throw new Error("Conexão com Banco de Dados falhou.");

    const body = JSON.parse(event.body);
    const { amount, userId, userName, userDocument } = body;

    console.log('=== INICIANDO CRIAÇÃO DE PAGAMENTO EVOPAY ===', { userId, amount });

    if (!amount || !userId || !userName || !userDocument) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos obrigatórios: amount, userId, userName, userDocument' }) };
    }

    const cleanDocument = userDocument.replace(/\D/g, "");
    if (cleanDocument.length !== 11 && cleanDocument.length !== 14) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Documento inválido.' }) };
    }
    if (parseFloat(amount) < 30) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Depósito mínimo é R$ 30,00' }) };
    }

    const evopayToken = process.env.EVOPAY_TOKEN;
    if (!evopayToken) throw new Error("Token EVOPAY_TOKEN não configurado.");

    // Webhook URL com userId na query string
    const SITE_URL = process.env.URL || 'http://localhost:8888';
    const callbackUrl = `${SITE_URL}/.netlify/functions/webhook-payment?u=${userId}`;

    // Chamada API EvoPay
    const response = await axios.post('https://pix.evopay.cash/v1/pix', {
      amount: parseFloat(amount),
      callbackUrl: callbackUrl,
      payerName: userName,
      payerDocument: cleanDocument
    }, {
      headers: { 'API-Key': evopayToken, 'Content-Type': 'application/json' }
    });

    const paymentData = response.data;
    const pixCode = paymentData.qrCodeText || paymentData.qrcode;

    if (!pixCode) throw new Error("Código PIX não retornado pela EvoPay");

    const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixCode)}`;
    const depositRef = db.collection('deposits').doc();
    
    // Salva no Firestore
    await depositRef.set({
      userId,
      userName,
      amount: parseFloat(amount),
      pixCode: pixCode,
      qrImage: qrImage,
      transactionId: depositRef.id,
      status: 'pending',
      gateway: 'evopay',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        pixCode: pixCode,
        qrImage: qrImage,
        transactionId: depositRef.id,
        depositId: depositRef.id,
        message: 'PIX gerado com sucesso'
      })
    };

  } catch (error) {
    console.error("Erro na Function create-payment:", error.response?.data || error.message);
    return {
      statusCode: error.response?.status || 500,
      headers,
      body: JSON.stringify({ success: false, error: error.response?.data?.message || error.message || 'Falha ao processar pagamento' })
    };
  }
};
