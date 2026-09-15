export function toTopicPayload({ ownerId, participantId, title, category, sessionMode, tableCode, zoomUrl, details }) {
  return {
    owner_id: ownerId,
    author_participant_id: participantId,
    title: title.trim(),
    category,
    session_mode: sessionMode,
    table_code: sessionMode === 'in_person' ? tableCode : null,
    zoom_url: sessionMode === 'zoom' && zoomUrl?.trim() ? zoomUrl.trim() : null,
    details: details?.trim() || ''
  };
}

const unwrap = async query => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const toTopicModel = (topic, ownerId) => ({
  ...topic,
  interestCount: topic.open_space_interests?.length || 0,
  commentCount: topic.open_space_comments?.length || 0,
  interestedByMe: Boolean(ownerId && topic.open_space_interests?.some(interest => interest.owner_id === ownerId))
});

export function createOpenSpaceService(supabase) {
  return {
    async listTopics(ownerId) {
      const topics = await unwrap(supabase.from('open_space_topics').select('*, open_space_interests(id, owner_id), open_space_comments(id)').order('created_at', { ascending: false }));
      return topics.map(topic => toTopicModel(topic, ownerId));
    },
    async createTopic(draft) {
      return unwrap(supabase.from('open_space_topics').insert(toTopicPayload(draft)).select().single());
    },
    async deleteTopic(topicId) {
      return unwrap(supabase.from('open_space_topics').delete().eq('id', topicId));
    },
    async toggleInterest({ topicId, ownerId, participantId, interested }) {
      if (interested) return unwrap(supabase.from('open_space_interests').delete().eq('topic_id', topicId).eq('owner_id', ownerId));
      return unwrap(supabase.from('open_space_interests').insert({ topic_id: topicId, owner_id: ownerId, participant_id: participantId }));
    },
    async listComments(topicId) {
      return unwrap(supabase.from('open_space_comments').select('*').eq('topic_id', topicId).order('created_at', { ascending: true }));
    },
    async createComment({ topicId, ownerId, participantId, body }) {
      return unwrap(supabase.from('open_space_comments').insert({ topic_id: topicId, owner_id: ownerId, author_participant_id: participantId, body: body.trim() }).select().single());
    },
    subscribe({ onTopicChange, onInterestChange, onCommentChange }) {
      const channel = supabase.channel('open-space-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'open_space_topics' }, onTopicChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'open_space_interests' }, onInterestChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'open_space_comments' }, onCommentChange)
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
  };
}
