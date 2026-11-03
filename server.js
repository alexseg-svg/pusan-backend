require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Форматирование заказа в красивый чек для поваров
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
📍 <b>Куда:</b> ${orderType === 'dine_in' ? `Столик №${customer.table}` : 'Навынос / Доставка'}
${comment ? `💬 <b>Пожелания:</b> ${comment}\n` : ''}
🥢 <b>Заказ:</b>
${itemsList}

💰 <b>ИТОГО: ${total} ₽</b>
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

    // Отправляем в Telegram-группу
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });

    console.log(`✅ Заказ столика №${orderData.customer?.table || '—'} улетел в Telegram!`);
    return res.status(200).json({ success: true, message: 'Заказ принят!' });

  } catch (error) {
    console.error('❌ Ошибка отправки:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍜 Сервер Pusan Eat запущен на http://localhost:${PORT}`);
});