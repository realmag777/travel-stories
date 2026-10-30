// Fixed dictionaries shared by seeds, server and client.
// Categories keep the original project's _id values so imported stories match.
// Facet value labels live in the facet_values table; these lists are the seed source.

const CATEGORIES = [
  { _id: '68fb50c80ae91338641121f0', name: 'Азія', en: 'Asia', es: 'Asia' },
  { _id: '68fb50c80ae91338641121f1', name: 'Гори', en: 'Mountains', es: 'Montañas' },
  { _id: '68fb50c80ae91338641121f2', name: 'Європа', en: 'Europe', es: 'Europa' },
  { _id: '68fb50c80ae91338641121f3', name: 'Америка', en: 'America', es: 'América' },
  { _id: '68fb50c80ae91338641121f4', name: 'Африка', en: 'Africa', es: 'África' },
  { _id: '68fb50c80ae91338641121f5', name: 'Грузія', en: 'Georgia', es: 'Georgia' },
  { _id: '68fb50c80ae91338641121f6', name: 'Пустелі', en: 'Deserts', es: 'Desiertos' },
  { _id: '68fb50c80ae91338641121f7', name: 'Балкани', en: 'Balkans', es: 'Balcanes' },
  { _id: '68fb50c80ae91338641121f8', name: 'Кавказ', en: 'Caucasus', es: 'Cáucaso' },
  { _id: '68fb50c80ae91338641121f9', name: 'Океанія', en: 'Oceania', es: 'Oceanía' },
];

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_LABELS = {
  spring: { uk: 'Весна', en: 'Spring', es: 'Primavera' },
  summer: { uk: 'Літо', en: 'Summer', es: 'Verano' },
  autumn: { uk: 'Осінь', en: 'Autumn', es: 'Otoño' },
  winter: { uk: 'Зима', en: 'Winter', es: 'Invierno' },
};

const BUDGETS = ['low', 'medium', 'high'];
const BUDGET_LABELS = {
  low: { uk: 'Низький', en: 'Low', es: 'Bajo' },
  medium: { uk: 'Середній', en: 'Medium', es: 'Medio' },
  high: { uk: 'Високий', en: 'High', es: 'Alto' },
};

const TRIP_TYPES = ['solo', 'couple', 'family', 'friends'];
const TRIP_TYPE_LABELS = {
  solo: { uk: 'Соло', en: 'Solo', es: 'En solitario' },
  couple: { uk: 'Пара', en: 'Couple', es: 'En pareja' },
  family: { uk: "Сім'я", en: 'Family', es: 'En familia' },
  friends: { uk: 'Друзі', en: 'Friends', es: 'Con amigos' },
};

// Duration facet buckets in days, inclusive.
const DURATIONS = [
  { slug: '1-3', min: 1, max: 3, uk: '1–3 дні', en: '1–3 days', es: '1–3 días' },
  { slug: '4-7', min: 4, max: 7, uk: '4–7 днів', en: '4–7 days', es: '4–7 días' },
  { slug: '8-14', min: 8, max: 14, uk: '8–14 днів', en: '8–14 days', es: '8–14 días' },
  { slug: '15-plus', min: 15, max: 10000, uk: '15+ днів', en: '15+ days', es: '15+ días' },
];

const TAGS = [
  { slug: 'hiking', uk: 'Походи', en: 'Hiking', es: 'Senderismo' },
  { slug: 'beach', uk: 'Пляж', en: 'Beach', es: 'Playa' },
  { slug: 'food', uk: 'Гастрономія', en: 'Food', es: 'Gastronomía' },
  { slug: 'city-break', uk: 'Міський відпочинок', en: 'City break', es: 'Escapada urbana' },
  { slug: 'history', uk: 'Історія', en: 'History', es: 'Historia' },
  { slug: 'nature', uk: 'Природа', en: 'Nature', es: 'Naturaleza' },
  { slug: 'photography', uk: 'Фотографія', en: 'Photography', es: 'Fotografía' },
  { slug: 'road-trip', uk: 'Автоподорож', en: 'Road trip', es: 'Viaje por carretera' },
  { slug: 'culture', uk: 'Культура', en: 'Culture', es: 'Cultura' },
  { slug: 'wine', uk: 'Вино', en: 'Wine', es: 'Vino' },
  { slug: 'museums', uk: 'Музеї', en: 'Museums', es: 'Museos' },
  { slug: 'architecture', uk: 'Архітектура', en: 'Architecture', es: 'Arquitectura' },
  { slug: 'islands', uk: 'Острови', en: 'Islands', es: 'Islas' },
  { slug: 'camping', uk: 'Кемпінг', en: 'Camping', es: 'Camping' },
  { slug: 'skiing', uk: 'Лижі', en: 'Skiing', es: 'Esquí' },
  { slug: 'diving', uk: 'Дайвінг', en: 'Diving', es: 'Buceo' },
  { slug: 'festivals', uk: 'Фестивалі', en: 'Festivals', es: 'Festivales' },
  { slug: 'nightlife', uk: 'Нічне життя', en: 'Nightlife', es: 'Vida nocturna' },
  { slug: 'with-kids', uk: 'З дітьми', en: 'With kids', es: 'Con niños' },
  { slug: 'wildlife', uk: 'Дика природа', en: 'Wildlife', es: 'Fauna' },
  { slug: 'desert', uk: 'Пустеля', en: 'Desert', es: 'Desierto' },
  { slug: 'lakes', uk: 'Озера', en: 'Lakes', es: 'Lagos' },
  { slug: 'train', uk: 'Потягом', en: 'By train', es: 'En tren' },
  { slug: 'backpacking', uk: 'Бекпекінг', en: 'Backpacking', es: 'Mochilero' },
  { slug: 'slow-travel', uk: 'Повільні подорожі', en: 'Slow travel', es: 'Viaje lento' },
  { slug: 'national-parks', uk: 'Нацпарки', en: 'National parks', es: 'Parques nacionales' },
  { slug: 'street-art', uk: 'Стріт-арт', en: 'Street art', es: 'Arte urbano' },
  { slug: 'markets', uk: 'Ринки', en: 'Markets', es: 'Mercados' },
];

module.exports = {
  CATEGORIES, SEASONS, SEASON_LABELS, BUDGETS, BUDGET_LABELS,
  TRIP_TYPES, TRIP_TYPE_LABELS, DURATIONS, TAGS,
};
