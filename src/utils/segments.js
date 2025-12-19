const { SEGMENTS } = require('../config/constants');

function validateSegment(start, end, category) {
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Invalid timestamp format');
  }

  const duration = end - start;

  if (start < 0 || end < 0) {
    throw new Error('Timestamps cannot be negative');
  }

  if (start >= end) {
    throw new Error('End time must be after start time');
  }

  if (duration < SEGMENTS.DURATION.MIN) {
    throw new Error(`Segment too short (${duration}s). Minimum is ${SEGMENTS.DURATION.MIN}s.`);
  }

  if (duration > SEGMENTS.DURATION.MAX) {
    throw new Error(`Segment too long (${duration}s). Maximum is ${SEGMENTS.DURATION.MAX}s.`);
  }

  if (!['intro', 'outro'].includes(category)) {
    throw new Error('Category must be either "intro" or "outro"');
  }
}

function groupSimilarSegments(segments) {
  if (segments.length === 0) return [];
  
  const intros = segments.filter(s => s.category === 'intro');
  const outros = segments.filter(s => s.category === 'outro');
  
  const result = [
    ...processSegmentGroup(intros, SEGMENTS.GROUPING.TIME_THRESHOLD),
    ...processSegmentGroup(outros, SEGMENTS.GROUPING.TIME_THRESHOLD)
  ];
  
  return result;
}

function processSegmentGroup(segments, timeThreshold) {
  if (segments.length === 0) return [];
  
  // Handle single segment case
  if (segments.length === 1) {
    const segment = segments[0];
    return [{
      id: segment.segmentId,
      type: segment.category,
      start: Number(segment.startTime),
      end: Number(segment.endTime),
      votes: segment.votes || 0,
      userVotes: segment.userVotes || {},
      sampleSize: 1,
      score: segment.votes + 0.5
    }];
  }
  
  // Filter segments by minimum vote threshold
  segments = segments.filter(segment => (segment.votes || 0) >= SEGMENTS.GROUPING.MIN_VOTES);
  if (segments.length === 0) return [];
  
  segments.sort((a, b) => a.startTime - b.startTime);
  
  const groups = [];
  let currentGroup = [];
  
  segments.forEach(segment => {
    if (currentGroup.length === 0) {
      currentGroup.push(segment);
    } else {
      const medianStart = currentGroup[Math.floor(currentGroup.length / 2)].startTime;
      const medianEnd = currentGroup[Math.floor(currentGroup.length / 2)].endTime;
      
      if (Math.abs(segment.startTime - medianStart) <= timeThreshold && 
          Math.abs(segment.endTime - medianEnd) <= timeThreshold) {
        currentGroup.push(segment);
      } else {
        groups.push(currentGroup);
        currentGroup = [segment];
      }
    }
  });
  
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  const result = groups.map(group => {
    const starts = group.map(s => Number(s.startTime)).sort((a, b) => a - b);
    const ends = group.map(s => Number(s.endTime)).sort((a, b) => a - b);
    
    // Merge userVotes from all segments in the group
    const mergedUserVotes = {};
    group.forEach(segment => {
      if (segment.userVotes) {
        Object.entries(segment.userVotes).forEach(([userId, vote]) => {
          // If a user voted on multiple segments in the group, take their most recent vote
          mergedUserVotes[userId] = vote;
        });
      }
    });
    
    const totalVotes = Object.values(mergedUserVotes).reduce((sum, v) => sum + v, 0);
    
    if (group.length > 1 && totalVotes / group.length < SEGMENTS.GROUPING.MIN_VOTE_RATIO) {
      return null;
    }
    
    const medianStart = starts[Math.floor(starts.length / 2)];
    const medianEnd = ends[Math.floor(ends.length / 2)];
    
    return {
      id: group[0].segmentId,
      type: group[0].category,
      start: medianStart,
      end: medianEnd,
      sampleSize: group.length,
      votes: totalVotes,
      userVotes: mergedUserVotes,
      score: totalVotes + (group.length / 2)
    };
  })
  .filter(segment => segment !== null)
  .sort((a, b) => b.score - a.score)
  .slice(0, 1);
  
  return result;
}

module.exports = {
  validateSegment,
  groupSimilarSegments
};