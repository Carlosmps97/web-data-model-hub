import { relationshipLabel, type RelationshipPhrases } from '../lib/relationshipLabel';

/** Frase de la relación (doc 98) bajo un link de Properties · Links y del
 *  Object Inspector: COMPLETA (el corte con «…» es solo del canvas). No pinta
 *  nada si la relación no tiene frases. */
export default function RelationshipPhraseLine({ rel }: { rel: RelationshipPhrases }) {
  const phrase = relationshipLabel(rel, Infinity);
  if (!phrase) return null;
  return <div className="wk-pp-link-card wk-pp-link-phrase">{phrase}</div>;
}
