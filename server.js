require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Отдаем наш сайт из папки public
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Форматирование чека для кухни
function formatOrderMessage(order) {
  const { customer, items, total, orderType, comment } = order;

  let itemsList = items
    .map(item => `▪️ <b>${item.name}</b> x${item.quantity} — <i>${item.price * item.quantity} ₽</i>`)
    .join('\n');

  return `
🔔 <b>НОВЫЙ ЗАКАЗ В ПУСАН!</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Гость:</b> ${customer.name}
📞 <b>Тел:</b> ${customer.phone}
📍 <b>Куда:</b> ${orderType === 'dine_in' ? `Столик №${customer.table}` : '🛍 НАВЫНОС'}
${comment ? `💬 <b>Пожелания:</b> ${comment}\n` : ''}
🍣 <b>Состав заказа:</b>
${itemsList}

💰 <b>ИТОГО К ОПЛАТЕ: ${total} ₽</b>
━━━━━━━━━━━━━━━━━━
⏰ <i>${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</i>
  `.trim();
}

// Прием заказа
app.post('/api/order', async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Корзина пуста' });
    }

    const message = formatOrderMessage(orderData);

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });

    console.log(`✅ Заказ принят на сумму: ${orderData.total} ₽`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка отправки:', error.response?.data || error.message);
    return res.status(500).json({ success: false });
  }
});

// Для любых других путей отдаем главную страницу
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍜 Сервер Pusan Eat запущен на порту ${PORT}`);
});
