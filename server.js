require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Отдаем сайт из папки public
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Счетчик ОПЛАЧЕННЫХ заказов
let paidOrderCounter = 1;

// Временная память ТОЛЬКО для заказов, которые еще на этапе оплаты
const awaitingPaymentOrders = {};

// 1. Создание платежа СБП (Поварам НИЧЕГО НЕ ОТПРАВЛЯЕТСЯ!)
app.post('/api/payment/create', (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Корзина пуста' });
    }

    // Создаем временный ID ожидания
    const tempId = 'pay_' + Date.now();
    awaitingPaymentOrders[tempId] = orderData;

    // Ссылка на шлюз СБП
    const paymentUrl = `/sbp-pay.html?orderId=${tempId}&total=${orderData.total}`;
    
    console.log(`⏳ Гость перешел к оплате СБП на сумму ${orderData.total} ₽`);
    return res.status(200).json({ success: true, paymentUrl });

  } catch (err) {
    console.error('Ошибка создания СБП:', err.message);
    return res.status(500).json({ success: false });
  }
});

// 2. Банк подтвердил оплату ➔ ТОЛЬКО ТЕПЕРЬ заказ уходит на кухню!
app.post('/api/payment/confirm', async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = awaitingPaymentOrders[orderId];

    if (!order) {
      return res.status(404).json({ success: false, message: 'Заказ не найден или уже оплачен' });
    }

    // ПРИСВАИВАЕМ НОМЕР ТОЛЬКО ОПЛАЧЕННОМУ ЗАКАЗУ!
    const orderNum = String(paidOrderCounter++).padStart(2, '0');
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const typeLabel = order.orderType === 'takeaway' ? '🛍 С СОБОЙ (В ПАКЕТЕ)' : '🍽 В ЗАЛЕ (НА ПОДНОСЕ)';

    const itemsList = order.items
      .map(i => `▪️ <b>${i.name}</b> x${i.quantity} — <i>${i.price * i.quantity} ₽</i>`)
      .join('\n');

    // Чек с ЖЕЛЕЗНЫМ подтверждением 100% предоплаты
    const kitchenText = `
🔔 <b>ЗАКАЗ #${orderNum} [${typeLabel}]</b>
━━━━━━━━━━━━━━━━━━
💰 <b>Оплата:</b> 💳 <b>ОПЛАЧЕНО 100% (СБП Альфа) ✅</b>
👤 <b>Гость:</b> ${order.customer?.name || 'Гость'} (${order.customer?.phone || '—'})
${order.comment ? `💬 <b>Пожелания:</b> ${order.comment}\n` : ''}
🥢 <b>Состав заказа:</b>
${itemsList}

💰 <b>ИТОГО: ${order.total} ₽</b>
🔘 <b>Статус:</b> 🔴 Новый (ожидает)
━━━━━━━━━━━━━━━━━━
⏰ Время оплаты: <i>${time}</i>
    `.trim();

    // Шлем заказ поварам!
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: kitchenText,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '👨‍🍳 Принять в работу', callback_data: `cook_${orderNum}` }]
        ]
      }
    });

    console.log(`✅ ЗАКАЗ #${orderNum} ОПЛАЧЕН ЧЕРЕЗ СБП (${order.total} ₽) И ПЕРЕДАН ПОВАРАМ!`);

    // Удаляем из временной памяти
    delete awaitingPaymentOrders[orderId];

    return res.status(200).json({ success: true, orderNum });

  } catch (err) {
    console.error('Ошибка подтверждения оплаты:', err.response?.data || err.message);
    return res.status(500).json({ success: false });
  }
});

// 3. Обработка кнопок поваров
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const callbackQuery = req.body?.callback_query;
    if (!callbackQuery) return res.sendStatus(200);

    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    const chatId = callbackQuery.message.chat.id;
    const currentText = callbackQuery.message.text;

    if (data.startsWith('cook_')) {
      const orderNum = data.replace('cook_', '');
      const updatedText = currentText.replace('🔴 Новый (ожидает)', '🟡 ГОТОВИТСЯ (в работе)');

      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: updatedText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔔 ЗАКАЗ ГОТОВ К ВЫДАЧЕ!', callback_data: `ready_${orderNum}` }]
          ]
        }
      });

      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id,
        text: `👨‍🍳 Заказ #${orderNum} принят в работу!`
      });

    } else if (data.startsWith('ready_')) {
      const orderNum = data.replace('ready_', '');
      const updatedText = currentText.replace('🟡 ГОТОВИТСЯ (в работе)', '🟢 ГОТОВ К ВЫДАЧЕ ✅');

      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: updatedText,
        parse_mode: 'HTML'
      });

      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id,
        text: `✅ Заказ #${orderNum} готов к выдаче!`,
        show_alert: true
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    return res.sendStatus(200);
  }
});

// Отдаем сайт
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🍜 Сервер Pusan Eat запущен на порту ${PORT}`);
  try {
    const directWebhook = `https://pusan-backend.onrender.com/api/telegram-webhook`;
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: directWebhook
    });
  } catch (e) {}
});
