/*
 * Вебхук Telegram-бота Spattel.
 *
 * Зачем он нужен. У Telegram нет встроенных автоответов: без этого кода бот молчит, а сообщения,
 * которые ему напишут, не видит никто. И отвечать клиенту может только сам бот — из личного
 * аккаунта в переписку с ботом не попасть. Поэтому связь здесь двусторонняя.
 *
 * Путь клиента:
 *   ссылка с сайта → /start → приветствие и кнопки с целью обращения
 *   → выбрал цель → бот просит имя и телефон
 *   → прислал → карточка заявки падает в рабочую группу
 *   → менеджер отвечает на карточку обычным reply → бот доставляет ответ клиенту
 *
 * Как бот помнит выбранную цель. Базы нет и состояние между запросами не хранится. Цель написана
 * в тексте вопроса, на который клиент отвечает (ForceReply), и вычитывается обратно из
 * reply_to_message. По той же причине id клиента написан в карточке заявки: отвечая на неё,
 * менеджер тем самым указывает адресата. Строки «Цель:» и «id NNN» менять нельзя — по ним идёт
 * разбор. Из-за этого же телефон вводится текстом: кнопка «поделиться контактом» присылает
 * сообщение без reply, и привязка к цели теряется.
 *
 * Переменные окружения (Vercel → Project spattel1 → Settings → Environment Variables):
 *   TELEGRAM_BOT_TOKEN      — токен от @BotFather. Секрет, в репозиторий не попадает.
 *   TELEGRAM_CHAT_ID        — id рабочей группы. Узнаётся командой /id в самой группе.
 *   TELEGRAM_WEBHOOK_SECRET — произвольная строка, та же, что передана в setWebhook.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

/*
 * Цели повторяют продуктовую линейку: Старт, Стандарт, Подписка — и ничего сверх неё.
 * Порядок тот же, что на сайте: сначала замер и смета, это точка входа.
 */
const GOALS = [
  { key: 'start', label: 'Замер, дизайн-проект и смета' },
  { key: 'standard', label: 'Ремонт квартиры под ключ' },
  { key: 'subscription', label: 'Я уже ремонтировался со Spattel' },
  { key: 'other', label: 'Другой вопрос' },
];

const GREETING =
  'Это <b>Spattel</b> — ремонт квартир под ключ в Перми.\n\n' +
  'Чтобы передать вас нужному человеку, выберите, с чем пришли.';

/** Маркеры, по которым разбираются ответы. Формат менять нельзя. */
const GOAL_MARK = /^Цель: (.+)$/m;
const ID_MARK = /\bid (\d+)\b/;

const ASK_CONTACT =
  'Напишите одним сообщением, как к вам обращаться и по какому номеру звонить.\n\n' +
  'Например: Иван, +7 912 345-67-89';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'ответ не разобран' }));
  if (!data.ok) console.error('telegram', method, data.description);
  return data;
}

/** Как подписать клиента в рабочей группе: имя, @логин, id — всё одной строкой. */
function whoIs(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Без имени';
  const login = from.username ? ` @${from.username}` : '';
  return `${escapeHtml(name)}${escapeHtml(login)} · id ${from.id}`;
}

/**
 * Достаёт российский номер из свободного текста и приводит к +7XXXXXXXXXX.
 * Возвращает null, если номера нет — тогда бот переспрашивает, а не шлёт менеджеру мусор.
 */
function parsePhone(text) {
  const digits = String(text).replace(/\D/g, '');
  if (/^[78]\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+7${digits}`;
  return null;
}

/** Менеджеру номер нужно читать и набирать глазами, а не расшифровывать. */
function prettyPhone(phone) {
  const d = phone.slice(2);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

/** Имя — это всё, что осталось от текста после вычёркивания номера. */
function parseName(text, from) {
  const cleaned = String(text)
    .replace(/[+\d()\-\s]{7,}/g, ' ')
    .replace(/[,;.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || from.first_name || 'Без имени';
}

function goalKeyboard() {
  return {
    inline_keyboard: GOALS.map((g) => [{ text: g.label, callback_data: `goal:${g.key}` }]),
  };
}

/** Клиент выбрал цель — убираем кнопки и просим контакт, помня цель в тексте вопроса. */
async function onGoal(query) {
  const goal = GOALS.find((g) => g.key === String(query.data).replace('goal:', ''));
  await tg('answerCallbackQuery', { callback_query_id: query.id });
  if (!goal) return;

  await tg('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    text: `${GREETING}\n\n✅ Вы выбрали: <b>${escapeHtml(goal.label)}</b>`,
  });

  await tg('sendMessage', {
    chat_id: query.message.chat.id,
    text: `Цель: ${goal.label}\n\n${ASK_CONTACT}`,
    reply_markup: { force_reply: true, input_field_placeholder: 'Иван, +7 912 345-67-89' },
  });
}

/** Клиент прислал контакт в ответ на вопрос — собираем карточку заявки. */
async function onContact(msg, goalLabel) {
  const raw = msg.text || msg.contact?.phone_number || '';
  const phone = msg.contact ? parsePhone(msg.contact.phone_number) : parsePhone(raw);

  if (!phone) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: `Цель: ${goalLabel}\n\nНе получилось разобрать номер. Пришлите его целиком, с кодом: +7 912 345-67-89`,
      reply_markup: { force_reply: true, input_field_placeholder: 'Иван, +7 912 345-67-89' },
    });
    return;
  }

  const name = msg.contact
    ? [msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(' ')
    : parseName(raw, msg.from);

  if (CHAT_ID) {
    await tg('sendMessage', {
      chat_id: CHAT_ID,
      parse_mode: 'HTML',
      text:
        '🔔 <b>Заявка из Телеграма</b>\n\n' +
        `Цель: ${escapeHtml(goalLabel)}\n` +
        `Имя: ${escapeHtml(name)}\n` +
        `Телефон: ${escapeHtml(prettyPhone(phone))}\n` +
        `Клиент: ${whoIs(msg.from)}\n\n` +
        '<i>Ответьте на это сообщение — бот передаст ответ клиенту.</i>',
    });
  } else {
    console.error('TELEGRAM_CHAT_ID не задан: заявку некуда переслать');
  }

  await tg('sendMessage', {
    chat_id: msg.chat.id,
    parse_mode: 'HTML',
    text:
      `Спасибо, ${escapeHtml(name)}. Передал менеджеру: <b>${escapeHtml(goalLabel)}</b>, ` +
      `${escapeHtml(prettyPhone(phone))}.\n\nОтветим в рабочее время. Здесь же можно прислать фотографии и планировку.`,
    reply_markup: { remove_keyboard: true },
  });
}

/** Свободное сообщение клиенту — переносим в группу как есть. */
async function onFreeform(msg) {
  if (!CHAT_ID) {
    console.error('TELEGRAM_CHAT_ID не задан: сообщение клиента некуда переслать');
    return;
  }

  const text = msg.text || msg.caption || '';
  const tail = '\n\n<i>Ответьте на это сообщение — бот передаст ответ клиенту.</i>';

  if (msg.text) {
    await tg('sendMessage', {
      chat_id: CHAT_ID,
      parse_mode: 'HTML',
      text: `💬 <b>${whoIs(msg.from)}</b>\n\n${escapeHtml(text)}${tail}`,
    });
    return;
  }

  // Фотографии, голосовые, документы: сначала подпись с id, следом сам файл.
  await tg('sendMessage', {
    chat_id: CHAT_ID,
    parse_mode: 'HTML',
    text: `📎 <b>${whoIs(msg.from)}</b> прислал вложение${text ? `\n\n${escapeHtml(text)}` : ''}${tail}`,
  });
  await tg('forwardMessage', {
    chat_id: CHAT_ID,
    from_chat_id: msg.chat.id,
    message_id: msg.message_id,
  });
}

/** Менеджер ответил в группе — доставляем ответ клиенту. */
async function fromGroup(msg) {
  if (msg.text && msg.text.trim().startsWith('/id')) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      parse_mode: 'HTML',
      text: `id этой группы: <code>${msg.chat.id}</code>\n\nВпишите его в TELEGRAM_CHAT_ID на Vercel.`,
    });
    return;
  }

  const source = msg.reply_to_message;
  if (!source || !source.from || !source.from.is_bot) return; // обычная болтовня в группе

  const found = (source.text || source.caption || '').match(ID_MARK);
  if (!found) return;

  const answer = msg.text || msg.caption;
  if (!answer) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      reply_to_message_id: msg.message_id,
      text: 'Бот умеет передавать только текст. Напишите ответ словами.',
    });
    return;
  }

  const sent = await tg('sendMessage', { chat_id: found[1], text: answer });
  await tg('sendMessage', {
    chat_id: msg.chat.id,
    reply_to_message_id: msg.message_id,
    text: sent.ok
      ? '✅ Отправлено клиенту'
      : `⚠️ Не доставлено: ${sent.description || 'клиент мог заблокировать бота'}`,
  });
}

async function onPrivate(msg) {
  if (msg.text && msg.text.startsWith('/start')) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      parse_mode: 'HTML',
      text: GREETING,
      reply_markup: goalKeyboard(),
    });

    const source = msg.text.slice(6).trim(); // «/start site» → «site»
    if (CHAT_ID) {
      await tg('sendMessage', {
        chat_id: CHAT_ID,
        parse_mode: 'HTML',
        text: `👋 Новый диалог: <b>${whoIs(msg.from)}</b>${source ? `\nПришёл: ${escapeHtml(source)}` : ''}`,
      });
    }
    return;
  }

  // Ответ на вопрос бота о контакте — цель лежит в тексте того вопроса.
  const goal = (msg.reply_to_message?.text || '').match(GOAL_MARK);
  if (goal && msg.reply_to_message.from?.is_bot) {
    await onContact(msg, goal[1]);
    return;
  }

  await onFreeform(msg);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  // Адрес вебхука публичный, поэтому постучаться может кто угодно. Пускаем только Telegram.
  if (!SECRET || req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(401).json({ ok: false });
  }
  if (!TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN не задан');
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body || {};
    if (update.callback_query) {
      await onGoal(update.callback_query);
    } else if (update.message) {
      const msg = update.message;
      if (msg.chat.type === 'private') await onPrivate(msg);
      else await fromGroup(msg);
    }
  } catch (e) {
    // Telegram повторяет доставку при любом коде, кроме 200, поэтому отвечаем 200 всегда.
    console.error('сбой обработки', e);
  }

  return res.status(200).json({ ok: true });
};
