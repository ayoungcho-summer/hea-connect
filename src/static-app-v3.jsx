import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Search, Sparkles, Users } from 'lucide-react';
import data from './data/matches.json';
import { filterPeople } from './directory-search.js';
import OpenSpace from './open-space.jsx';

const people = data.participants;
const byId = new Map(people.map((person) => [person.id, person]));
const initials = (name) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2);

function Avatar({ person }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="avatar">
      {person.profileImage && !failed ? (
        <img src={person.profileImage} alt="" onError={() => setFailed(true)} />
      ) : initials(person.name)}
    </div>
  );
}

function LinkedInLink({ person }) {
  if (!person.linkedIn) return null;
  return (
    <a className="linkedin" href={person.linkedIn} target="_blank" rel="noreferrer"
      aria-label={`Open ${person.name}'s LinkedIn profile`}>
      <span className="in-icon">in</span><span>LinkedIn</span><ArrowUpRight size={14} />
    </a>
  );
}

function ProfileCard({ person }) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const detailRefs = useRef([]);
  const hasDetails = person.lookingFor || person.canOffer;
  useEffect(() => {
    if (expanded) return undefined;
    const checkForTruncation = () => {
      setIsTruncated(detailRefs.current.some((element) => element && element.scrollHeight > element.clientHeight + 1));
    };
    checkForTruncation();
    const observer = new ResizeObserver(checkForTruncation);
    detailRefs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, [expanded, person.id]);
  return (
    <article className={`person-card ${expanded ? 'details-expanded' : ''}`}>
      <div className="person-top">
        <Avatar person={person} />
        <span className="member">{person.heaMember === 'Yes' ? 'HEA member' : 'Community guest'}</span>
      </div>
      <h3 className="person-name">{person.name}</h3>
      <p className="headline" title={person.headline}>{person.headline || 'HEA event attendee'}</p>
      {person.role && <span className="role-label">{person.role}</span>}
      <div className="tags">{person.industries.map((industry) => <span key={industry}>{industry}</span>)}</div>
      {hasDetails && <div className="askoffer">
        {person.lookingFor && <div><span className="ask-key">↗ ASK</span><p ref={(element) => { detailRefs.current[0] = element; }}>{person.lookingFor}</p></div>}
        {person.canOffer && <div><span className="offer-key">↙ OFFER</span><p ref={(element) => { detailRefs.current[1] = element; }}>{person.canOffer}</p></div>}
      </div>}
      <div className="person-footer directory-footer">
        {isTruncated ? <button className="profile-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show less' : 'Show full details'}
        </button> : <span />}
        <LinkedInLink person={person} />
      </div>
    </article>
  );
}

function MatchCard({ match, index }) {
  const person = byId.get(match.participantId);
  if (!person) return null;
  return (
    <article className="match-card">
      <div className="match-top"><span className="match-rank">{String(index + 1).padStart(2, '0')}</span><span className="match-score">{match.score}% <small>match</small></span></div>
      {match.matchType !== 'strong' && <span className="match-basis">{match.matchType === 'shared_luma_interest' ? 'Shared Luma interest' : 'Complementary ask & offer'}</span>}
      <Avatar person={person} />
      <h3>{person.name}</h3>
      <p className="headline">{person.experiences.join(' · ') || person.headline}</p>
      <h4><Sparkles size={14} />Why you should connect</h4>
      <p>{match.reason}</p>
      <LinkedInLink person={person} />
    </article>
  );
}

export default function StaticApp() {
  const [tab, setTab] = useState('directory');
  const [query, setQuery] = useState('');
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const visible = filterPeople(people, query);
  const matches = data.matchesByParticipantId[selected] || [];
  const findMatches = () => {
    const participant = people.find((person) => person.email.toLowerCase() === email.trim().toLowerCase());
    if (participant) { setSelected(participant.id); setError(''); }
    else setError('This email is not in the attendee list.');
  };

  return <main>
    <header className="site-header"><a className="brand" href="/" aria-label="HEA Connect home"><img className="brand-logo" src="/hea-logo-berkeley-blue.svg" alt="Haas Entrepreneurship Association" /><span className="brand-divider" /><span className="brand-name">HAAS ENTREPRENEURSHIP<br />ASSOCIATION</span></a>
      <nav className="desktop-nav"><button className={tab === 'directory' ? 'active' : ''} onClick={() => setTab('directory')}>The community</button><button className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>Find your people <Sparkles size={14} /></button><button className={tab === 'open-space' ? 'active' : ''} onClick={() => setTab('open-space')}>Open Space</button></nav>
    </header>
    <section className="hero"><div className="hero-copy"><span className="event-kicker">THE HEA BACK TO SCHOOL SOCIAL · FALL ’26</span><h1>Big ideas.<br />Even better <span>connections.</span></h1><p>{people.length} real attendees, prepared for meaningful introductions.</p></div></section>
    <section className="workspace"><div className="workspace-tabs"><button className={tab === 'directory' ? 'selected' : ''} onClick={() => setTab('directory')}><Users size={17} />People directory <span className="count-pill">{people.length}</span></button><button className={tab === 'matches' ? 'selected' : ''} onClick={() => setTab('matches')}><Sparkles size={17} />My matches</button><button className={tab === 'open-space' ? 'selected' : ''} onClick={() => setTab('open-space')}>Open Space</button></div>
      {tab === 'directory' ? <>
        <div className="section-heading"><div><span className="eyebrow">THE HEA BACK TO SCHOOL SOCIAL</span><h2>Make a meaningful connection.</h2></div></div>
        <div className="filter-panel"><div className="search-box"><Search size={19} /><input aria-label="Search participants" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, background, or industry…" /></div></div>
        <p className="directory-summary">Showing <strong>{visible.length}</strong> people</p>
        <div className="people-grid">{visible.map((person) => <ProfileCard key={person.id} person={person} />)}</div>
      </> : tab === 'open-space' ? <OpenSpace participants={people} onOpenProfile={(participantId) => { setQuery(byId.get(participantId)?.name || ''); setTab('directory'); }} /> : <section className="matching">
        <div className="matching-intro"><div className="sparkle-box"><Sparkles size={27} /></div><h2>Your three introductions.</h2><p>Enter your event email or choose your name.</p></div>
        <div className="matching-picker"><label htmlFor="match-email">Your email</label><div><input id="match-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /><button className="primary" onClick={findMatches}>Find my matches</button></div><label htmlFor="match-person">Or select your name</label><select id="match-person" value={selected} onChange={(event) => { setSelected(event.target.value); setError(''); }}><option value="">Choose your profile</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{error && <p className="error">{error}</p>}</div>
        {matches.length > 0 && <><div className="results-heading"><h3>Three conversations worth starting</h3></div><div className="match-grid">{matches.map((match, index) => <MatchCard key={match.participantId} match={match} index={index} />)}</div></>}
        {selected && matches.length === 0 && <div className="no-matches" role="status"><h3>No strong matches yet</h3><p>We only show introductions scoring 60% or higher, and none cleared that threshold for this profile.</p></div>}
      </section>}
    </section>
  </main>;
}
