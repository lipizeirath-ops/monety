// ========================================
// NETLIFY FUNCTION: Verificar Status do Pagamento
// ========================================
const { verificarStatusPagamento } = require('./vizzionpay');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  try {
    const { transactionId } = event.queryStringParameters;

    if (!transactionId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'transactionId é obrigatório' }) };
    }

    const statusInfo = await verificarStatusPagamento(transactionId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        status: statusInfo.status,
        amount: statusInfo.amount,
        payedAt: statusInfo.payedAt,
        availableAt: statusInfo.availableAt
      })
    };

  } catch (error) {
    return {
      statusCode: error.status || 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Falha ao verificar status',
        details: error.message
      })
    };
  }
};
