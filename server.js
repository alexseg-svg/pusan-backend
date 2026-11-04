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

// Простой счетчик заказов за день
let orderCounter = 1;
// Хранилище заказов в памяти сервера
const ordersDB = {};

// Форматирование чека для кухни
function formatKitchenText(order, statusText) {
  const { orderNum, customer, items, total, orderType, comment, time } = order;
  const typeLabel = orderType === 'takeaway' ? '🛍 С СОБОЙ (В ПАКЕТЕ)' : '🍽 В ЗАЛЕ (НА ПОДНОСЕ)';

  const itemsList = items
    .map(i => `▪️ <b>${i.name}</b> x${i.quantity} — <i>${i.price * i.quantity} ₽</i>`)
    .join('\n');

  return `
🔔 <b>ЗАКАЗ #${orderNum}</b> [${typeLabel}]
━━━━━━━━━━━━━━━━━━
👤 <b>Гость:</b> ${customer.name} (${customer.phone})
${comment ? `💬 <b>Пожелания:</b> ${comment}\n` : ''}
🥢 <b>Состав заказа:</b>
${itemsList}

💰 <b>ИТОГО: ${total} ₽</b>
🔘 <b>Статус:</b> ${statusText}
━━━━━━━━━━━━━━━━━━
⏰ Время заказа: <i>${time}</i>
  `.trim();
}

// 1. Прием заказа с сайта
app.post('/api/order', async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Корзина пуста' });
    }

    // Присваиваем красивый двухзначный номер (#01, #02...)
    const orderNum = String(orderCounter++).padStart(2, '0');
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    const fullOrder = {
      ...orderData,
      orderNum,
      time,
      status: 'new'
    };

    ordersDB[orderNum] = fullOrder;

    // Первоначальное сообщение с кнопкой «Принять в работу»
    const text = formatKitchenText(fullOrder, '🔴 <b>Новый (ожидает)</b>');

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

    console.log(`✅ Заказ #${orderNum} отправлен на кухню!`);
    return res.status(200).json({ success: true, orderNum: orderNum });

  } catch (error) {
    console.error('❌ Ошибка отправки заказа:', error.response?.data || error.message);
    return res.status(500).json({ success: false });
  }
});

// 2. Обработка нажатий на кнопки от поваров (Telegram Webhook)
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const callbackQuery = req.body?.callback_query;
    if (!callbackQuery) return res.sendStatus(200);

    const data = callbackQuery.data; // например cook_01 или ready_01
    const messageId = callbackQuery.message.message_id;
    const chatId = callbackQuery.message.chat.id;

    if (data.startsWith('cook_')) {
      const orderNum = data.replace('cook_', '');
      const order = ordersDB[orderNum];

      if (order) {
        order.status = 'cooking';
        const updatedText = formatKitchenText(order, '🟡 <b>ГОТОВИТСЯ (в работе)</b>');

        // Меняем сообщение и кнопку в чате кухни
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

        // Если клиент заказывал через Telegram-бота — шлем пуш клиенту!
        if (order.telegramId) {
          try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              chat_id: order.telegramId,
              text: `👨‍🍳 <b>Ваш заказ #${orderNum} принят и уже готовится!</b>\nМы пришлем сообщение, когда можно будет забрать.`,
              parse_mode: 'HTML'
            });
          } catch(e){}
        }
      }
    } else if (data.startsWith('ready_')) {
      const orderNum = data.replace('ready_', '');
      const order = ordersDB[orderNum];

      if (order) {
        order.status = 'ready';
        const updatedText = formatKitchenText(order, '🟢 <b>ГОТОВ К ВЫДАЧЕ ✅</b>');

        // Убираем кнопки (заказ закрыт)
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: updatedText,
          parse_mode: 'HTML'
        });

        // Шлем громкий пуш клиенту в ЛС бота (замена пейджеру!)
        if (order.telegramId) {
          try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              chat_id: order.telegramId,
              text: `🔔 <b>ЗАКАЗ #${orderNum} ГОТОВ К ВЫДАЧЕ!</b>\n\nПожалуйста, подойдите к стойке <b>ПУСАН</b> и покажите этот экран. Приятного аппетита! 🥢🍱`,
              parse_mode: 'HTML'
            });
          } catch(e){}
        }
      }
    }

    // Отвечаем Телеграму, чтобы кнопка перестала крутиться
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackQuery.id
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.response?.data || err.message);
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

  // Сервер САМ сообщает Телеграму адрес для кнопок при запуске:
  try {
    const webhookUrl = 'https://pusaneat.ru/api/telegram-webhook';
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: webhookUrl
    });
    console.log(`🚀 Telegram Webhook успешно настроен на ${webhookUrl}!`);
  } catch (err) {
    console.error('Ошибка настройки Webhook:', err.response?.data || err.message);
  }
});
