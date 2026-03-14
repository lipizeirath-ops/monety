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

    let cleanName = (userName || "Cliente").replace(/[^a-zA-Z ]/g, "").trim();
    if (!cleanName) cleanName = "Cliente";

    const evopayToken = process.env.EVOPAY_TOKEN;
    if (!evopayToken) throw new Error("Token EVOPAY_TOKEN não configurado.");

    const SITE_URL = process.env.URL || 'http://localhost:8888';
    const callbackUrl = `${SITE_URL}/.netlify/functions/webhook-payment?u=${userId}`;

    // 1. Chamada à EvoPay
    const response = await axios.post('https://pix.evopay.cash/v1/pix', {
      amount: parseFloat(amount),
      callbackUrl: callbackUrl,
      payerName: cleanName,
      payerDocument: cleanDocument
    }, {
      headers: { 'API-Key': evopayToken, 'Content-Type': 'application/json' }
    });

    // 2. Extração Robusta do Código PIX
    const paymentData = response.data;
    
    // Mapeamos todas as chaves possíveis para máxima compatibilidade com as respostas da API
    const brCode = 
      paymentData?.qrCodeText || 
      paymentData?.qrcode || 
      paymentData?.qrCode || 
      paymentData?.pixCode || 
      paymentData?.data?.qrcode || 
      paymentData?.data?.qrCodeText;

    // Se falhar, lançamos erro com log do formato exato para depuração
    if (!brCode) {
      console.error("Resposta inesperada da EvoPay, brCode não encontrado:", JSON.stringify(paymentData));
      throw new Error("Código PIX não retornado pela EvoPay. Verifique os logs.");
    }

    // 3. Geração do link da Imagem QR Code
    const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(brCode)}`;
    
    const depositRef = db.collection('deposits').doc();
    
    // 4. Salvando no Firestore
    await depositRef.set({
      userId,
      userName, 
      amount: parseFloat(amount),
      pixCode: brCode, 
      qrImage: qrImage, 
      transactionId: depositRef.id,
      status: 'pending',
      gateway: 'evopay',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 5. Retorno para o Frontend (React)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        // Chaves no padrão camelCase
        pixCode: brCode,
        qrImage: qrImage,
        transactionId: depositRef.id,
        // Chaves de segurança no padrão snake_case (referência do seu código antigo)
        pix_code: brCode,
        qr_image: qrImage 
      })
    };

  } catch (error) {
    console.error("Erro na Function create-payment:", error.response?.data || error.message);
    return {
      statusCode: error.response?.status || 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.response?.data?.message || error.message || 'Falha ao processar pagamento' 
      })
    };
  }
};
