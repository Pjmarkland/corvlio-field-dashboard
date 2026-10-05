import { DataSet, englishDataset, englishRecommendedTransformers, parseRawPattern, RegExpMatcher } from "obscenity";

export const BUSINESS_NAME_MESSAGE = "Please use your real business name without offensive language.";

// Keep the maintained English list and its per-term exceptions. These words
// alone are also ordinary personal names; explicit vulgar compounds stay blocked.
const dataset = new DataSet<{ originalWord: string }>()
  .addAll(englishDataset)
  .removePhrasesIf(phrase => ["dick", "cock", "hooker"].includes(phrase.metadata?.originalWord ?? ""))
  .addPhrase(phrase => {
    phrase.setMetadata({ originalWord: "explicit-business-name-variants" });
    for (const term of [
      "fucks", "fucking", "fucked", "fucker[s]", "f[*]cking", "f[*]cked", "f[*]cker[s]",
      "motherfucker[s]", "motherfucking",
      "bullshit", "shithead[s]", "shitty", "bitches", "bitching", "bitchy",
      "bastards", "asshole[s]", "arsehole[s]", "dumbass", "jackass",
      "cocksucker[s]", "dickhead[s]", "fag[g]ot[s]", "nazi[s]", "heil[?]hitler",
    ]) phrase.addPattern(parseRawPattern(term));
    return phrase;
  });

function boundedMatcher(words: DataSet<{ originalWord: string }>) {
  const built = words.build();
  return new RegExpMatcher({
    ...built,
    ...englishRecommendedTransformers,
    // Never use unrestricted substring matching: Scunthorpe, Penistone,
    // Hancock, Dickson, Cassidy, Sussex, and similar real names must survive.
    blacklistedTerms: built.blacklistedTerms.map(term => ({
      ...term,
      pattern: {
        ...term.pattern,
        nodes: [...term.pattern.nodes, ...parseRawPattern("[s]").nodes],
        requireWordBoundaryAtStart: true,
        requireWordBoundaryAtEnd: true,
      },
    })),
  });
}

const matcher = boundedMatcher(dataset);
// Joining short chunks can turn innocent phrases such as "Pen Is" into anatomy
// words. Only use the spacing pass for profanity/slurs, not these ambiguous nouns.
const spacingMatcher = boundedMatcher(new DataSet<{ originalWord: string }>()
  .addAll(dataset)
  .removePhrasesIf(phrase => [
    "anal", "anus", "boob", "booby", "clit", "nipple", "penis", "sex", "tit",
    "testicle", "vagina",
  ].includes(phrase.metadata?.originalWord ?? "")));

/** Local-only validation. Does not censor/rename stored data or call a service. */
export function businessNameValidationError(value: string): string | null {
  const name = value.trim();
  if (!name || name.length > 160) return "Please enter your real business name (up to 160 characters).";
  // Unicode compatibility/accents and invisible separators are normalized ONLY
  // for checking; accepted names retain their spelling when saved.
  const normalized = name.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
  if (matcher.hasMatch(normalized)) return BUSINESS_NAME_MESSAGE;

  // Check bounded adjacent short chunks, e.g. f u c k, fu ck, f.u.c.k,
  // n 1 g g 3 r. Never join the entire name or look inside a longer normal word.
  const chunks = normalized.split(/[^\p{L}\p{N}@!$]+/u).filter(Boolean);
  for (let start = 0; start < chunks.length; start++) {
    let joined = "";
    for (let end = start; end < chunks.length && end < start + 12; end++) {
      const chunk = chunks[end];
      if (!chunk || chunk.length > 3) break;
      joined += chunk;
      if (end > start && spacingMatcher.hasMatch(joined)) return BUSINESS_NAME_MESSAGE;
    }
  }
  return null;
}
