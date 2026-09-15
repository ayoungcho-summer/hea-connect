const QUERY_ALIASES = {
  디자인: 'design',
};

const searchableText = (person) => [
  person.name,
  person.headline,
  person.role,
  ...(person.industries || []),
  ...(person.connectGoals || []),
  person.lookingFor,
  person.canOffer,
].filter(Boolean).join(' ').toLocaleLowerCase();

const queryTerms = (query) => {
  const normalized = query.trim().toLocaleLowerCase();
  return [normalized, QUERY_ALIASES[normalized]].filter(Boolean);
};

export const filterPeople = (people, query) => {
  const terms = queryTerms(query);
  if (!terms.length) return people;
  return people.filter((person) => {
    const text = searchableText(person);
    return terms.some((term) => text.includes(term));
  });
};
