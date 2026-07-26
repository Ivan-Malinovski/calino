/**
 * Keyword → event icon matching.
 *
 * Maps an event's text (title, falling back to location) to one of a set of
 * Lucide icons rendered as a subtle decoration on event cards and the preview
 * popup. Purely cosmetic — a miss returns `null` and the card renders exactly
 * as before.
 *
 * `matchEventBackground` is the single source of truth for the id mapping; the
 * icon each id resolves to lives in `EventBackground.tsx`.
 */

export type EventBackgroundId =
  | 'mountain'
  | 'bike'
  | 'coffee'
  | 'plane'
  | 'cake'
  | 'party'
  | 'gym'
  | 'run'
  | 'music'
  | 'food'
  | 'cooking'
  | 'drinks'
  | 'wine'
  | 'beach'
  | 'snow'
  | 'fishing'
  | 'garden'
  | 'meeting'
  | 'call'
  | 'work'
  | 'school'
  | 'reading'
  | 'medical'
  | 'shopping'
  | 'gift'
  | 'car'
  | 'train'
  | 'movie'
  | 'gaming'
  | 'sports'
  | 'haircut'
  | 'pet'
  | 'baby'
  | 'date'
  | 'laundry'
  | 'photo'
  | 'art'
  | 'money'
  | 'church'

/**
 * Keyword rules, evaluated in order. The first rule with any keyword that
 * appears as a whole word (or word prefix) in the text wins. Order matters when
 * terms overlap — put the more specific scene first (e.g. `cooking` before
 * `food`, `coffee` before `meeting`).
 */
const RULES: ReadonlyArray<{ id: EventBackgroundId; keywords: readonly string[] }> = [
  {
    id: 'mountain',
    keywords: ['hik', 'trek', 'climb', 'boulder', 'mountain', 'trail', 'summit', 'camp'],
  },
  { id: 'bike', keywords: ['bike', 'biking', 'cycl', 'ride'] },
  {
    id: 'coffee',
    keywords: ['coffee', 'cafe', 'café', 'espresso', 'latte', 'cappuccino', 'brunch'],
  },
  { id: 'cake', keywords: ['birthday', 'cake', 'anniversary'] },
  { id: 'party', keywords: ['party', 'celebrat', 'bday', 'housewarming'] },
  {
    id: 'plane',
    keywords: [
      'flight',
      'fly',
      'flying',
      'plane',
      'airport',
      'trip',
      'vacation',
      'holiday',
      'travel',
    ],
  },
  {
    id: 'gym',
    keywords: [
      'gym',
      'workout',
      'lift',
      'fitness',
      'training',
      'crossfit',
      'yoga',
      'pilates',
      'meditat',
      'mindful',
    ],
  },
  { id: 'run', keywords: ['run', 'running', 'jog', 'marathon', '5k', '10k'] },
  {
    id: 'music',
    keywords: ['concert', 'gig', 'music', 'band', 'festival', 'rehearsal', 'orchestra', 'choir'],
  },
  { id: 'cooking', keywords: ['cook', 'bake', 'baking', 'meal prep', 'recipe'] },
  { id: 'wine', keywords: ['wine', 'vineyard', 'winery'] },
  { id: 'drinks', keywords: ['beer', 'pub', 'bar', 'drinks', 'cocktail', 'happy hour', 'brewery'] },
  {
    id: 'food',
    keywords: [
      'dinner',
      'lunch',
      'restaurant',
      'meal',
      'pizza',
      'sushi',
      'burger',
      'tacos',
      'ramen',
      'bbq',
      'barbecue',
    ],
  },
  { id: 'snow', keywords: ['ski', 'skiing', 'snowboard', 'snow', 'sled'] },
  { id: 'fishing', keywords: ['fish', 'fishing', 'angling'] },
  { id: 'garden', keywords: ['garden', 'gardening', 'planting', 'weeding', 'allotment'] },
  { id: 'beach', keywords: ['beach', 'swim', 'surf', 'pool', 'ocean', 'seaside', 'snorkel'] },
  {
    id: 'medical',
    keywords: [
      'doctor',
      'dentist',
      'dr ',
      'clinic',
      'hospital',
      'physio',
      'checkup',
      'check-up',
      'vaccine',
      'therapy',
      'gp ',
    ],
  },
  {
    id: 'school',
    keywords: [
      'class',
      'lecture',
      'exam',
      'school',
      'homework',
      'course',
      'seminar',
      'tutorial',
      'study',
    ],
  },
  { id: 'reading', keywords: ['read', 'reading', 'book club', 'library'] },
  { id: 'call', keywords: ['call', 'phone', 'facetime', 'ring '] },
  {
    id: 'meeting',
    keywords: [
      'meeting',
      'meet',
      'standup',
      'stand-up',
      'sync',
      '1:1',
      '1-1',
      'kickoff',
      'kick-off',
      'interview',
      'presentation',
      'demo',
      'retro',
      'catch up',
      'catch-up',
    ],
  },
  {
    id: 'shopping',
    keywords: ['shopping', 'grocery', 'groceries', 'mall', 'supermarket', 'errand'],
  },
  { id: 'gift', keywords: ['gift', 'present', 'wrapping'] },
  {
    id: 'car',
    keywords: ['drive', 'driving', 'car ', 'roadtrip', 'road trip', 'mechanic', 'garage'],
  },
  { id: 'train', keywords: ['train', 'rail', 'metro', 'subway', 'commute'] },
  { id: 'movie', keywords: ['movie', 'cinema', 'film', 'netflix', 'premiere'] },
  {
    id: 'gaming',
    keywords: [
      'gaming',
      'video game',
      'board game',
      'xbox',
      'playstation',
      'nintendo',
      'boardgame',
    ],
  },
  {
    id: 'sports',
    keywords: [
      'match',
      'tournament',
      'soccer',
      'football',
      'basketball',
      'tennis',
      'golf',
      'cricket',
      'rugby',
      'baseball',
      'hockey',
    ],
  },
  { id: 'haircut', keywords: ['haircut', 'barber', 'salon', 'hairdresser'] },
  { id: 'pet', keywords: ['vet', 'puppy', 'dog walk', 'walk the dog', 'grooming'] },
  { id: 'baby', keywords: ['baby', 'newborn', 'nursery', 'daycare', 'pediatric', 'paediatric'] },
  { id: 'date', keywords: ['date night', 'valentine', 'wedding', 'engagement', 'romantic'] },
  { id: 'laundry', keywords: ['laundry', 'washing', 'ironing', 'clean', 'chores', 'vacuum'] },
  { id: 'photo', keywords: ['photo', 'photography', 'photoshoot', 'photo shoot'] },
  { id: 'art', keywords: ['paint', 'painting', 'drawing', 'sketch', 'pottery', 'craft'] },
  {
    id: 'money',
    keywords: ['bill', 'invoice', 'rent', 'bank', 'budget', 'tax', 'salary', 'payment'],
  },
  { id: 'church', keywords: ['church', 'mass', 'worship', 'prayer', 'bible', 'sermon'] },
  {
    id: 'work',
    keywords: [
      'work',
      'office',
      'shift',
      'deadline',
      'project',
      'report',
      'email',
      'admin',
      'planning',
    ],
  },
]

// Precompile one regex per rule (`\b(kw1|kw2|…)`) so matching is a single test
// per rule rather than one per keyword — this runs on every card render.
const COMPILED: ReadonlyArray<{ id: EventBackgroundId; re: RegExp }> = RULES.map((rule) => ({
  id: rule.id,
  re: new RegExp(`\\b(?:${rule.keywords.map(escapeRegExp).join('|')})`, 'i'),
}))

/**
 * Resolve the icon id for an event's text, or `null` if nothing matches.
 * Matching is case-insensitive and word-boundary aware so "brunch" doesn't trip
 * on "runch" and "runway" doesn't match "run".
 */
export function matchEventBackground(text: string | undefined | null): EventBackgroundId | null {
  if (!text) return null
  for (const { id, re } of COMPILED) {
    if (re.test(text)) return id
  }
  return null
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
