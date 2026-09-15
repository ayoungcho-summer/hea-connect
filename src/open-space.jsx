import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock3, ExternalLink, MessageCircle, Plus, Send, Trash2, Users, Video, X } from 'lucide-react';
import { canDeleteTopic, formatTopicLocation, OPEN_SPACE_CATEGORIES, participantForIdentity, savedIdentityKey, TABLE_CODES, validateTopicDraft } from './open-space-domain.js';
import { createOpenSpaceService } from './open-space-service.js';
import { ensureAnonymousSession, getSupabaseClient } from './supabase-client.js';

const blankDraft = () => ({ title: '', category: 'Idea Exchange', sessionMode: 'in_person', tableCode: 'A', zoomUrl: '', details: '' });
const initials = name => String(name || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2);
const timeLabel = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const OPEN_SPACE_START = new Date('2026-09-17T16:30:00-07:00').getTime();

function timeUntilOpen(now) {
  const totalSeconds = Math.max(0, Math.ceil((OPEN_SPACE_START - now) / 1000));
  return { days: Math.floor(totalSeconds / 86400), hours: Math.floor((totalSeconds % 86400) / 3600), minutes: Math.floor((totalSeconds % 3600) / 60), seconds: totalSeconds % 60 };
}

function OpenSpaceCountdown({ now }) {
  const remaining = timeUntilOpen(now);
  const units = [['Days', remaining.days], ['Hours', remaining.hours], ['Minutes', remaining.minutes], ['Seconds', remaining.seconds]];
  return <div className="open-space-countdown" aria-live="polite">
    <div className="open-space-countdown-mark"><Clock3 size={25} /></div>
    <span className="open-space-kicker">OPEN SPACE OPENS AT THE EVENT</span>
    <h3>See you at the table.</h3>
    <p>Open Space will go live on <strong>Thursday, September 17 at 4:30 PM</strong>. Bring a question, an idea, or a coffee invite for the room.</p>
    <div className="open-space-timer" aria-label={`${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, and ${remaining.seconds} seconds until Open Space opens`}>
      {units.map(([label, value]) => <div className="open-space-timer-unit" key={label}><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></div>)}
    </div>
  </div>;
}

function PersonMark({ person, compact = false }) {
  const [failed, setFailed] = useState(false);
  return <span className={`open-space-person-mark ${compact ? 'compact' : ''}`}>
    {person?.profileImage && !failed ? <img src={person.profileImage} alt="" onError={() => setFailed(true)} /> : <span>{initials(person?.name)}</span>}
  </span>;
}

function IdentityModal({ participants, selectedId, onSelect, onClose }) {
  const [value, setValue] = useState(selectedId || '');
  return <div className="open-space-backdrop" role="presentation"><section className="open-space-modal identity-modal" role="dialog" aria-modal="true" aria-label="Choose your profile">
    <button className="open-space-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
    <span className="open-space-kicker">OPEN SPACE</span><h2>Who’s joining the conversation?</h2>
    <p>Choose your event profile once. Your name and photo will appear on topics, interest signals, and comments.</p>
    <label>Your event profile<select value={value} onChange={event => setValue(event.target.value)}><option value="">Choose your name</option>{participants.map(person => <option value={person.id} key={person.id}>{person.name} — {person.email}</option>)}</select></label>
    <button className="primary" disabled={!value} onClick={() => { onSelect(value); onClose(); }}>Continue <ExternalLink size={15} /></button>
  </section></div>;
}

function TopicModal({ onClose, onCreate, busy }) {
  const [draft, setDraft] = useState(blankDraft);
  const [error, setError] = useState('');
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const submit = async event => {
    event.preventDefault();
    const validation = validateTopicDraft(draft);
    if (validation) { setError(validation); return; }
    setError('');
    try { await onCreate(draft); } catch (reason) { setError(reason.message || 'Unable to create this topic.'); }
  };
  return <div className="open-space-backdrop" role="presentation"><section className="open-space-modal topic-modal" role="dialog" aria-modal="true" aria-label="Create Open Space topic">
    <div className="open-space-modal-head"><div><span className="open-space-kicker">OPEN SPACE</span><h2>Start a conversation</h2></div><button className="open-space-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
    <form onSubmit={submit} className="open-space-form">
      <label>Topic title<input autoFocus value={draft.title} maxLength={160} onChange={event => update('title', event.target.value)} placeholder="What would you like to explore?" /></label>
      <label>Category<select value={draft.category} onChange={event => update('category', event.target.value)}>{OPEN_SPACE_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
      <fieldset><legend>Session mode</legend><div className="open-space-mode-toggle"><button type="button" className={draft.sessionMode === 'in_person' ? 'selected' : ''} onClick={() => update('sessionMode', 'in_person')}><Users size={14} />In person</button><button type="button" className={draft.sessionMode === 'zoom' ? 'selected' : ''} onClick={() => update('sessionMode', 'zoom')}><Video size={14} />Zoom</button></div></fieldset>
      {draft.sessionMode === 'in_person' ? <label>Meet at<select value={draft.tableCode} onChange={event => update('tableCode', event.target.value)}>{TABLE_CODES.map(code => <option key={code} value={code}>Table {code}</option>)}</select></label> : <label>Zoom link <span className="optional">Optional</span><input type="url" value={draft.zoomUrl} onChange={event => update('zoomUrl', event.target.value)} placeholder="https://zoom.us/j/..." /></label>}
      <label>Details <span className="optional">Optional</span><textarea value={draft.details} maxLength={600} onChange={event => update('details', event.target.value)} placeholder="Share context, an agenda, or when you plan to meet." /></label>
      {error && <p className="open-space-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Creating…' : <><Plus size={16} />Create topic</>}</button>
    </form>
  </section></div>;
}

function Thread({ topic, comments, peopleById, currentPerson, onPost, onClose, busy }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    if (!body.trim()) return;
    setError('');
    try { await onPost(body); setBody(''); } catch (reason) { setError(reason.message || 'Unable to post this comment.'); }
  };
  return <aside className="open-space-thread" aria-label={`Discussion for ${topic.title}`}>
    <div className="open-space-thread-head"><div><span className="open-space-kicker">DISCUSSION</span><h3>{topic.title}</h3></div><button className="open-space-icon-button" onClick={onClose} aria-label="Close thread"><X size={18} /></button></div>
    <div className="open-space-comment-list">{comments.length ? comments.map(comment => { const author = peopleById.get(comment.author_participant_id); return <article className="open-space-comment" key={comment.id}><PersonMark person={author} compact /><div><strong>{author?.name || 'HEA attendee'}</strong><time>{timeLabel(comment.created_at)}</time><p>{comment.body}</p></div></article>; }) : <p className="open-space-empty-comments">Be the first to help organize this conversation.</p>}</div>
    {currentPerson && <form className="open-space-comment-form" onSubmit={submit}><label htmlFor="open-space-comment">Comment as {currentPerson.name}</label><textarea id="open-space-comment" value={body} maxLength={600} onChange={event => setBody(event.target.value)} placeholder="Add a question, a time, or a useful detail…" />{error && <p className="open-space-error">{error}</p>}<button className="primary" disabled={busy || !body.trim()}><Send size={15} />Post comment</button></form>}
  </aside>;
}

function TopicCard({ topic, author, currentOwnerId, onIdentityRequired, onInterest, onOpenThread, onDelete, onOpenProfile, busy }) {
  const removeAllowed = canDeleteTopic(topic, currentOwnerId);
  return <article className="open-space-card">
    <div className="open-space-card-top"><button className="open-space-author" onClick={() => onOpenProfile(topic.author_participant_id)}><PersonMark person={author} /><span><strong>{author?.name || 'HEA attendee'}</strong><small>{author?.headline || author?.role || 'Event attendee'}</small></span></button>{removeAllowed && <button className="open-space-delete" onClick={() => onDelete(topic)} aria-label="Delete topic"><Trash2 size={15} />Delete</button>}</div>
    <div className="open-space-topic-meta"><span className="open-space-category">{topic.category}</span><span className="open-space-location">{topic.session_mode === 'zoom' ? <Video size={13} /> : <Users size={13} />}{formatTopicLocation(topic)}</span></div>
    <h3>{topic.title}</h3>{topic.details && <p className="open-space-details">{topic.details}</p>}
    {topic.zoom_url && <a className="open-space-zoom" href={topic.zoom_url} target="_blank" rel="noreferrer">Open Zoom <ExternalLink size={13} /></a>}
    <div className="open-space-card-foot"><button className={`open-space-interest ${topic.interestedByMe ? 'active' : ''}`} disabled={busy} onClick={onInterest}>{topic.interestedByMe ? 'Interested' : "I'm Interested"}<span>{topic.interestCount}</span></button><button className="open-space-comments-button" onClick={onOpenThread}><MessageCircle size={15} />{topic.commentCount} {topic.commentCount === 1 ? 'comment' : 'comments'}<ChevronDown size={14} /></button></div>
    {!currentOwnerId && <button className="open-space-card-identity" onClick={onIdentityRequired}>Choose your profile to join this conversation</button>}
  </article>;
}

export default function OpenSpace({ participants, onOpenProfile }) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const service = useMemo(() => supabase ? createOpenSpaceService(supabase) : null, [supabase]);
  const peopleById = useMemo(() => new Map(participants.map(person => [person.id, person])), [participants]);
  const [participantId, setParticipantId] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem(savedIdentityKey) || '');
  const [ownerId, setOwnerId] = useState('');
  const [topics, setTopics] = useState([]);
  const [comments, setComments] = useState([]);
  const [threadTopic, setThreadTopic] = useState(null);
  const [showIdentity, setShowIdentity] = useState(false);
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [loading, setLoading] = useState(Boolean(service));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const currentPerson = participantForIdentity(participants, participantId);
  const eventIsLive = now >= OPEN_SPACE_START;

  useEffect(() => {
    if (eventIsLive) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [eventIsLive]);

  const refreshTopics = useCallback(async () => {
    if (!service || !ownerId) return;
    setLoading(true);
    try { setTopics(await service.listTopics(ownerId)); setError(''); }
    catch (reason) { setError(reason.message || 'Unable to load Open Space.'); }
    finally { setLoading(false); }
  }, [ownerId, service]);

  const refreshComments = useCallback(async topicId => {
    if (!service || !topicId) return;
    try { setComments(await service.listComments(topicId)); }
    catch (reason) { setError(reason.message || 'Unable to load comments.'); }
  }, [service]);

  useEffect(() => {
    if (!supabase || !service) return undefined;
    let active = true;
    ensureAnonymousSession(supabase).then(id => { if (active) setOwnerId(id); }).catch(reason => setError(reason.message || 'Unable to start an anonymous session.'));
    return () => { active = false; };
  }, [service, supabase]);

  useEffect(() => { if (ownerId) refreshTopics(); }, [ownerId, refreshTopics]);
  useEffect(() => { if (threadTopic) refreshComments(threadTopic.id); }, [threadTopic, refreshComments]);
  useEffect(() => {
    if (!service || !ownerId) return undefined;
    return service.subscribe({ onTopicChange: refreshTopics, onInterestChange: refreshTopics, onCommentChange: () => { refreshTopics(); if (threadTopic) refreshComments(threadTopic.id); } });
  }, [refreshComments, refreshTopics, service, threadTopic]);

  const chooseParticipant = id => { window.localStorage.setItem(savedIdentityKey, id); setParticipantId(id); };
  const needIdentity = () => { if (!currentPerson) { setShowIdentity(true); return false; } return true; };
  const ensureOwnerId = async () => {
    if (ownerId) return ownerId;
    const id = await ensureAnonymousSession(supabase);
    setOwnerId(id);
    return id;
  };
  const createTopic = async draft => {
    if (!needIdentity()) return;
    setBusy(true);
    try { const currentOwnerId = await ensureOwnerId(); await service.createTopic({ ...draft, ownerId: currentOwnerId, participantId: currentPerson.id }); setShowTopicModal(false); await refreshTopics(); }
    finally { setBusy(false); }
  };
  const toggleInterest = async topic => {
    if (!needIdentity()) return;
    setBusy(true);
    try { const currentOwnerId = await ensureOwnerId(); await service.toggleInterest({ topicId: topic.id, ownerId: currentOwnerId, participantId: currentPerson.id, interested: topic.interestedByMe }); await refreshTopics(); }
    catch (reason) { setError(reason.message || 'Unable to update interest.'); }
    finally { setBusy(false); }
  };
  const postComment = async body => {
    if (!needIdentity()) return;
    setBusy(true);
    try { const currentOwnerId = await ensureOwnerId(); await service.createComment({ topicId: threadTopic.id, ownerId: currentOwnerId, participantId: currentPerson.id, body }); await refreshComments(threadTopic.id); await refreshTopics(); }
    finally { setBusy(false); }
  };
  const deleteTopic = async topic => {
    if (!window.confirm(`Delete “${topic.title}”? This also removes its comments and interest signals.`)) return;
    setBusy(true);
    try { await service.deleteTopic(topic.id); if (threadTopic?.id === topic.id) setThreadTopic(null); await refreshTopics(); }
    catch (reason) { setError(reason.message || 'Unable to delete this topic.'); }
    finally { setBusy(false); }
  };

  if (!service) return <section className="open-space"><div className="open-space-unavailable"><span className="open-space-kicker">OPEN SPACE</span><h2>Live conversations are almost ready.</h2><p>This shared board needs its Supabase public configuration before attendees can create topics, comment, and coordinate in real time.</p></div></section>;

  return <section className="open-space"><div className="open-space-heading"><div><span className="open-space-kicker">THE EVENT’S LIVE BULLETIN BOARD</span><h2>Open Space</h2><p>{eventIsLive ? 'Start a focused conversation, pull up a chair, and make the next introduction happen.' : 'A live board for conversations that begin when the room comes together.'}</p></div><div className="open-space-heading-actions">{currentPerson ? <button className="open-space-identity" onClick={() => setShowIdentity(true)}><PersonMark person={currentPerson} compact />{currentPerson.name}</button> : <button className="text-button" onClick={() => setShowIdentity(true)}>Choose your profile</button>}{eventIsLive && <button className="primary" onClick={() => needIdentity() && setShowTopicModal(true)}><Plus size={16} />Create Topic Card</button>}</div></div>
    {error && <div className="open-space-error-bar" role="alert">{error}<button onClick={refreshTopics}>Try again</button></div>}
    {loading ? <div className="open-space-loading">Loading the conversation board…</div> : topics.length ? <div className="open-space-grid">{topics.map(topic => <TopicCard key={topic.id} topic={topic} author={peopleById.get(topic.author_participant_id)} currentOwnerId={ownerId} onIdentityRequired={() => setShowIdentity(true)} onInterest={() => toggleInterest(topic)} onOpenThread={() => setThreadTopic(topic)} onDelete={deleteTopic} onOpenProfile={onOpenProfile} busy={busy} />)}</div> : eventIsLive ? <div className="open-space-empty"><span>✦</span><h3>Be the first to open a table.</h3><p>Post a question, a founder search, or a casual coffee invite for the room.</p><button className="primary" onClick={() => needIdentity() && setShowTopicModal(true)}><Plus size={16} />Create the first topic</button></div> : <OpenSpaceCountdown now={now} />}
    {showIdentity && <IdentityModal participants={participants} selectedId={participantId} onSelect={chooseParticipant} onClose={() => setShowIdentity(false)} />}
    {showTopicModal && <TopicModal busy={busy} onClose={() => setShowTopicModal(false)} onCreate={createTopic} />}
    {threadTopic && <Thread topic={threadTopic} comments={comments} peopleById={peopleById} currentPerson={currentPerson} busy={busy} onPost={postComment} onClose={() => setThreadTopic(null)} />}
  </section>;
}
