require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Отдаем сайт
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let orderCounter = 1;

// 1. Прием заказа с сайта
app.post('/api/order', async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Корзина пуста' });
    }

    const orderNum = String(orderCounter++).padStart(2, '0');
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const typeLabel = orderData.orderType === 'takeaway' ? '🛍 С СОБОЙ (В ПАКЕТЕ)' : '🍽 В ЗАЛЕ (НА ПОДНОСЕ)';

    const itemsList = orderData.items
      .map(i => `▪️ <b>${i.name}</b> x${i.quantity} — <i>${i.price * i.quantity} ₽</i>`)
      .join('\n');

    const text = `
🔔 <b>ЗАКАЗ #${orderNum} [${typeLabel}]</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Гость:</b> ${orderData.customer?.name || 'Гость'} (${orderData.customer?.phone || '—'})
${orderData.comment ? `💬 <b>Пожелания:</b> ${orderData.comment}\n` : ''}
🥢 <b>Состав заказа:</b>
${itemsList}

💰 <b>ИТОГО: ${orderData.total} ₽</b>
🔘 <b>Статус:</b> 🔴 Новый (ожидает)
━━━━━━━━━━━━━━━━━━
⏰ Время заказа: <i>${time}</i>
    `.trim();

    // Отправляем заказ поварам с кнопкой
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '👨‍🍳 Принять в работу', callback_data: `cook_${orderNum}` }]
        ]
      }
    });

    console.log(`✅ Заказ #${orderNum} улетел поварам!`);
    return res.status(200).json({ success: true, orderNum: orderNum });

  } catch (error) {
    console.error('❌ Ошибка отправки заказа:', error.response?.data || error.message);
    return res.status(500).json({ success: false });
  }
});

// 2. Обработка кнопок поваров (Бронебойный Webhook)
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const callbackQuery = req.body?.callback_query;
    if (!callbackQuery) return res.sendStatus(200);

    const data = callbackQuery.data; // cook_01 или ready_01
    const messageId = callbackQuery.message.message_id;
    const chatId = callbackQuery.message.chat.id;
    const currentText = callbackQuery.message.text;

    if (data.startsWith('cook_')) {
      const orderNum = data.replace('cook_', '');
      
      // Заменяем статус прямо в тексте (не зависит от памяти сервера!)
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

      // Всплывающее окно повару в Телеграме
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id,
        text: `👨‍🍳 Заказ #${orderNum} принят в работу!`,
        show_alert: false
      });

    } else if (data.startsWith('ready_')) {
      const orderNum = data.replace('ready_', '');
      
      const updatedText = currentText.replace('🟡 ГОТОВИТСЯ (в работе)', '🟢 ГОТОВ К ВЫДАЧЕ ✅');

      // Убираем кнопки — чек закрыт
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: updatedText,
        parse_mode: 'HTML'
      });

      // Громкое всплывающее окно
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id,
        text: `✅ Заказ #${orderNum} готов к выдаче!`,
        show_alert: true
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('Ошибка в Webhook:', err.response?.data || err.message);
    return res.sendStatus(200);
  }
});

// Отдаем сайт
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Старт сервера и ПРЯМАЯ настройка Webhook Европа-Европа
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🍜 Сервер Pusan Eat запущен на порту ${PORT}`);

  try {
    // Шлем вебхук напрямую на Render (минуя Cloudflare)
    const directWebhook = `https://pusan-backend.onrender.com/api/telegram-webhook`;
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: directWebhook
    });
    console.log(`🚀 Прямой Webhook подключен: ${directWebhook}`);
  } catch (e) {
    console.error('Ошибка подключения Webhook:', e.response?.data || e.message);
  }
});
