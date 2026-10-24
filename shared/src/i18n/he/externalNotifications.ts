import type { NotificationLocale } from '../externalNotifications/types';

const he: NotificationLocale = {
  email: {
    footer: 'קיבלתם הודעה זו כי הפעלתם התראות ב-TREK.',
    manage: 'ניהול העדפות בהגדרות',
    madeWith: 'נוצר עם',
    openTrek: 'פתיחת TREK',
  },
  events: {
    trip_invite: (p) => ({
      title: `הזמנה לטיול: "${p.trip}"`,
      body: `${p.actor} הזמין/ה את ${p.invitee || 'חבר/ה'} לטיול "${p.trip}".`,
    }),
    booking_change: (p) => ({
      title: `הזמנה חדשה: ${p.booking}`,
      body: `${p.actor} הוסיף/ה ${p.type} חדש/ה "${p.booking}" אל "${p.trip}".`,
    }),
    trip_reminder: (p) => ({
      title: `תזכורת לטיול: ${p.trip}`,
      body: `הטיול "${p.trip}" מתקרב!`,
    }),
    todo_due: (p) => ({
      title: `משימה לביצוע: ${p.todo}`,
      body: `"${p.todo}" ב-"${p.trip}" צריכה להתבצע עד ${p.due}.`,
    }),
    vacay_invite: (p) => ({
      title: 'הזמנה לאיחוד חופשות',
      body: `${p.actor} הזמין/ה אתכם לאחד תוכניות חופשה. פתחו את TREK כדי לאשר או לדחות.`,
    }),
    vacay_share: (p) => ({
      title: 'לוח חופשות שותף',
      body: `${p.actor} שיתף/ה איתכם את לוח החופשות. פתחו את TREK כדי לצפות בו.`,
    }),
    collection_invite: (p) => ({
      title: 'הזמנה לאוסף',
      body: `${p.actor} הזמין/ה אתכם לשתף אוסף. פתחו את TREK כדי לאשר או לדחות.`,
    }),
    photos_shared: (p) => ({
      title: `${p.count} תמונות שותפו`,
      body: `${p.actor} שיתף/ה ${p.count} תמונות ב-"${p.trip}".`,
    }),
    collab_message: (p) => ({
      title: `הודעה חדשה ב-"${p.trip}"`,
      body: `${p.actor}: ${p.preview}`,
    }),
    packing_tagged: (p) => ({
      title: `אריזה: ${p.category}`,
      body: `${p.actor} שייך/ה אתכם לקטגוריית האריזה "${p.category}" ב-"${p.trip}".`,
    }),
    version_available: (p) => ({
      title: 'גרסה חדשה של TREK זמינה',
      body: `TREK ${p.version} זמין עכשיו. היכנסו ללוח הניהול כדי לעדכן.`,
    }),
    replica_failure: (p) => ({
      title: 'כשל בעותק אחסון',
      body:
        `כתיבה לעותק נכשלה ב-'${p.backend}': ${p.op} של ${p.key} — ${p.error}.` +
        (p.suppressed !== '0' ? ` ${p.suppressed} כשלים נוספים הוסתרו מאז ההתראה האחרונה.` : ''),
    }),
    synology_session_cleared: () => ({
      title: 'הפעלת Synology נוקתה',
      body: 'חשבון ה-Synology או הכתובת שלכם השתנו. התנתקתם מ-Synology Photos.',
    }),
    plugin_notification: (p) => ({ title: p.title ?? '', body: p.body ?? '' }),
  },
  passwordReset: {
    subject: 'איפוס הסיסמה שלכם',
    greeting: 'שלום',
    body: 'קיבלנו בקשה לאפס את הסיסמה של חשבון ה-TREK שלכם. לחצו על הכפתור למטה כדי להגדיר סיסמה חדשה.',
    ctaIntro: 'איפוס סיסמה',
    expiry: 'הקישור יפוג בעוד 60 דקות.',
    ignore: 'אם לא ביקשתם זאת, אפשר להתעלם מהאימייל — הסיסמה שלכם לא תשתנה.',
  },
};

export default he;
