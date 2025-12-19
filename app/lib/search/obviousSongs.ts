/**
 * obviousSongs.ts
 *
 * A tiny, curated "obvious hits" lookup used as a fast path for title-only queries.
 *
 * Goal:
 * - Improve recall for culturally dominant songs without extra network calls.
 * - Keep it small and high-confidence (this is not a full catalog).
 */

function normalizeTitleKeyLoose(title: string): string {
  return (title ?? "")
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ObviousSong = {
  artist: string;
  canonicalTitle: string;
};

function normalizePrimaryArtist(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;

  // Strip common featuring/collab markers. We only need a primary artist seed.
  // This is intentionally simple and conservative.
  const lowered = s.toLowerCase();
  const splitTokens = [
    " feat. ",
    " featuring ",
    " ft. ",
    " with ",
    " & ",
    " x ",
  ];
  for (const tok of splitTokens) {
    if (lowered.includes(tok)) {
      return s.split(new RegExp(tok, "i"))[0].trim();
    }
  }
  return s;
}

function parseObviousSongLines(input: string): Record<string, ObviousSong> {
  const out: Record<string, ObviousSong> = {};
  const lines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Skip headings / section labels
    if (!line.includes("–")) continue;
    if (/^obvious\s*\/\s*canonical/i.test(line)) continue;
    if (/songs$/i.test(line) && !line.includes("–")) continue;

    const parts = line.split(/\s+–\s+/);
    if (parts.length < 2) continue;
    const artist = normalizePrimaryArtist(parts[0]);
    const title = parts.slice(1).join(" – ").trim();
    if (!artist || !title) continue;

    const key = normalizeTitleKeyLoose(title);
    // First write wins (keeps list order stable)
    if (!out[key]) {
      out[key] = { artist, canonicalTitle: title };
    }
  }

  return out;
}

// Keep this list “medium” and only include high-confidence cultural defaults.
// IMPORTANT: This is used only to *add* candidates, never to exclude others.
//
// You can expand this list over time without affecting the main pipeline logic.
const OBVIOUS_SONGS = parseObviousSongLines(`
Bing Crosby – White Christmas
Elton John – Something About the Way You Look Tonight / Candle in the Wind 1997
Bing Crosby – Silent Night
Tino Rossi – Petit Papa Noël
Bill Haley & His Comets – Rock Around the Clock
Whitney Houston – I Will Always Love You
Stevie Wonder – I Wish
Elvis Presley – It’s Now or Never
USA for Africa – We Are the World
The Ink Spots – If I Didn’t Care
Celine Dion – My Heart Will Go On
Mariah Carey – All I Want for Christmas Is You
Bryan Adams – (Everything I Do) I Do It for You
Gloria Gaynor – I Will Survive
John Travolta & Olivia Newton-John – You’re the One That I Want
Scorpions – Wind of Change
Kyu Sakamoto – Sukiyaki
Gene Autry – Rudolph the Red-Nosed Reindeer
O-Zone – Dragostea Din Tei
The Beatles – I Want to Hold Your Hand
Andrea Bocelli & Sarah Brightman – Time to Say Goodbye
Village People – Y.M.C.A.
Band Aid – Do They Know It’s Christmas?
Los del Río – Macarena
Cher – Believe
Carl Douglas – Kung Fu Fighting
ABBA – Fernando
Toni Braxton – Un-Break My Heart
George Harrison – My Sweet Lord
The Monkees – I’m a Believer
Elvis Presley – Hound Dog
Procol Harum – A Whiter Shade of Pale
Boney M. – Rivers of Babylon
Britney Spears – …Baby One More Time
The Knack – My Sharona
Journey – Don’t Stop Believin’
Michael Jackson – Billie Jean
Wham! – Last Christmas
Queen – Bohemian Rhapsody
Nirvana – Smells Like Teen Spirit
AC/DC – Thunderstruck
Toto – Africa
Michael Jackson – Thriller
Bon Jovi – Livin’ on a Prayer
Goo Goo Dolls – Iris
Whitney Houston – I Wanna Dance with Somebody (Who Loves Me)
AC/DC – Back in Black
Michael Jackson – Beat It
Queen – We Will Rock You
Queen – Another One Bites the Dust
George Michael – Careless Whisper
Earth, Wind & Fire – September
Marvin Gaye & Tammi Terrell – Ain’t No Mountain High Enough
Survivor – Eye of the Tiger
Cyndi Lauper – Girls Just Want to Have Fun
Ed Sheeran – Shape of You
Luis Fonsi ft. Daddy Yankee – Despacito
Wiz Khalifa ft. Charlie Puth – See You Again
Adele – Rolling in the Deep
Mark Ronson ft. Bruno Mars – Uptown Funk
Billie Eilish – Bad Guy
Carly Rae Jepsen – Call Me Maybe
Taylor Swift – Love Story
Katy Perry – Firework
Adele – Someone Like You
Katy Perry – Roar
Lady Gaga – Poker Face
Pharrell Williams – Happy
Jason Mraz – I’m Yours
Lady Gaga – Bad Romance
Lorde – Royals
The Weeknd – Blinding Lights
Harry Styles – As It Was
Dua Lipa – Levitating
Miley Cyrus – Flowers
Taylor Swift – Cruel Summer
SZA – Kill Bill
The Beatles – Let It Be
The Beatles – Yesterday
The Rolling Stones – Satisfaction
Led Zeppelin – Stairway to Heaven
Pink Floyd – Wish You Were Here
Prince – Purple Rain
Madonna – Like a Prayer
U2 – With or Without You
Radiohead – Creep
Oasis – Wonderwall
Green Day – Basket Case
Metallica – Enter Sandman
OutKast – Hey Ya!
Rihanna – Umbrella
Britney Spears – Toxic
Drake – Hotline Bling
Daft Punk – One More Time
Avicii – Levels
Aretha Franklin – Respect
Otis Redding – (Sittin’ On) The Dock of the Bay
The Eagles – Hotel California
Fleetwood Mac – Dreams
The Doors – Light My Fire
Creedence Clearwater Revival – Fortunate Son
Lynyrd Skynyrd – Sweet Home Alabama
ABBA – Dancing Queen
Bee Gees – Stayin’ Alive
Donna Summer – I Feel Love
Talking Heads – Once in a Lifetime
Backstreet Boys – I Want It That Way
Spice Girls – Wannabe
Coldplay – Yellow
Linkin Park – In the End
The Killers – Mr. Brightside
Imagine Dragons – Radioactive
Usher – Yeah!
Alicia Keys – Fallin'
Darude – Sandstorm
Zedd – Clarity
Disclosure – Latch
Kelly Clarkson – Since U Been Gone
`);

// Extra aliases / typos that should map to a canonical title/artist.
// (These keys are user-input variants; the canonicalTitle is what we query MB with.)
OBVIOUS_SONGS[normalizeTitleKeyLoose("My Hear Will Go On")] = {
  artist: "Celine Dion",
  canonicalTitle: "My Heart Will Go On",
};

OBVIOUS_SONGS[normalizeTitleKeyLoose("Hit Me Baby One More Time")] = {
  artist: "Britney Spears",
  canonicalTitle: "...Baby One More Time",
};

export function getObviousSongForTitle(title: string): ObviousSong | null {
  const key = normalizeTitleKeyLoose(title);
  return OBVIOUS_SONGS[key] ?? null;
}
