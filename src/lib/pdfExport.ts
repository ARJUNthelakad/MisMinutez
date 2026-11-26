import { jsPDF } from 'jspdf';
import type { ActionItem, Decision, Meeting, TranscriptSegment } from '../types';
import { formatDuration, formatMeetingDate, getSpeakerDisplayName } from './format';

export function exportMeetingReportPdf(params: {
  meeting: Meeting;
  decisions: Decision[];
  actionItems: ActionItem[];
  segments: TranscriptSegment[];
  includeTranscript: boolean;
}): void {
  const { meeting, decisions, actionItems, segments, includeTranscript } = params;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 46;
  const contentWidth = pageWidth - margin * 2;
  let y = 52;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 52;
    }
  };

  const addSectionHeading = (title: string) => {
    ensureSpace(34);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, y);
    y += 5;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.75);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  };

  const addParagraph = (text: string, indent = 0) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text || 'None recorded.', contentWidth - indent);
    for (const line of lines) {
      ensureSpace(15);
      doc.text(line, margin + indent, y);
      y += 14;
    }
    y += 4;
  };

  const addBulletList = (items: string[], emptyLabel: string) => {
    if (!items || items.length === 0) {
      addParagraph(emptyLabel);
      return;
    }
    for (const item of items) {
      const lines = doc.splitTextToSize(`•  ${item}`, contentWidth - 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      for (const line of lines) {
        ensureSpace(15);
        doc.text(line, margin + 4, y);
        y += 14;
      }
      y += 2;
    }
    y += 4;
  };

  // Header Branding
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(29, 78, 216);
  doc.text('MISMINUTEZ  —  MULTILINGUAL MEETING MINUTES', margin, y);
  y += 22;

  // Meeting Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(meeting.title, contentWidth);
  for (const l of titleLines) {
    doc.text(l, margin, y);
    y += 22;
  }

  // Metadata row
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  const metaLine = [
    `Date: ${formatMeetingDate(meeting.startedAt)}`,
    `Duration: ${formatDuration(meeting.duration)}`,
    `Type: ${meeting.meetingType}`,
    meeting.venue?.trim() ? `Venue: ${meeting.venue.trim()}` : null,
    meeting.languagesDetected.length > 0
      ? `Languages: ${meeting.languagesDetected.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('   |   ');
  const metaLines = doc.splitTextToSize(metaLine, contentWidth);
  for (const ml of metaLines) {
    doc.text(ml, margin, y);
    y += 13;
  }
  if (meeting.attendees && meeting.attendees.length > 0) {
    const attendeeLine = `Attendees (${meeting.attendees.length}): ${meeting.attendees.join(', ')}`;
    const attLines = doc.splitTextToSize(attendeeLine, contentWidth);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    for (const al of attLines) {
      ensureSpace(14);
      doc.text(al, margin, y);
      y += 13;
    }
  }
  y += 10;

  // 1. Executive Summary
  addSectionHeading('1. Executive Summary');
  addParagraph(meeting.executiveSummary || 'No executive summary generated yet.');

  // 2. Meeting Objectives
  addSectionHeading('2. Meeting Objectives');
  addBulletList(meeting.objectives, 'No explicit objectives extracted.');

  // 3. Discussion Points
  addSectionHeading('3. Discussion Points');
  addBulletList(meeting.discussionPoints, 'No discussion points extracted.');

  // 4. Final Decisions
  const finalDecisions = decisions.filter((d) => d.decisionType === 'final');
  const otherDecisions = decisions.filter((d) => d.decisionType !== 'final');

  addSectionHeading('4. Final Decisions');
  addBulletList(
    finalDecisions.map(
      (d) =>
        `${d.decisionText}${d.speaker ? ` — ${d.speaker}` : ''}${d.timestamp ? ` [${d.timestamp}]` : ''}`
    ),
    'No final decisions were confirmed in this meeting.'
  );

  // 5. Proposed, Pending & Rejected Decisions
  addSectionHeading('5. Proposed, Pending & Rejected Proposals');
  addBulletList(
    otherDecisions.map(
      (d) =>
        `[${d.decisionType.toUpperCase()}] ${d.decisionText}${d.speaker ? ` — ${d.speaker}` : ''}`
    ),
    'No pending or proposed decisions.'
  );

  // 6. Action Items
  addSectionHeading('6. Action Items');
  if (actionItems.length === 0) {
    addParagraph('No action items were extracted.');
  } else {
    for (const item of actionItems) {
      const meta = `Owner: ${item.assignedTo || 'Unassigned'} | Deadline: ${item.deadline || 'Not specified'} | Priority: ${item.priority.toUpperCase()} | Status: ${item.status.toUpperCase()}`;
      ensureSpace(34);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const taskLines = doc.splitTextToSize(`•  ${item.task}`, contentWidth - 4);
      for (const l of taskLines) {
        ensureSpace(15);
        doc.text(l, margin + 4, y);
        y += 14;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(meta, margin + 16, y);
      y += 15;
    }
  }

  // 7. Unresolved Questions
  addSectionHeading('7. Unresolved Questions');
  addBulletList(meeting.unresolvedQuestions, 'No unresolved questions identified.');

  // 8. Risks
  addSectionHeading('8. Risks');
  addBulletList(meeting.risks, 'No explicit risks raised.');

  // 9. Follow-up Suggestions (AI Recommendations)
  addSectionHeading('9. Follow-up Suggestions (AI Recommendations)');
  addBulletList(meeting.followUpSuggestions, 'No follow-up recommendations generated.');

  // 10. Participants / Speaker Directory
  addSectionHeading('10. Speakers');
  const speakerLabels = Array.from(
    new Set([...Object.keys(meeting.speakers || {}), ...segments.map((s) => s.speakerLabel)])
  );
  addBulletList(
    speakerLabels.map((lbl) => getSpeakerDisplayName(lbl, meeting.speakers)),
    'No speaker diarization labels recorded.'
  );

  // 11. Conclusion
  if (meeting.meetingConclusion) {
    addSectionHeading('11. Meeting Conclusion');
    addParagraph(meeting.meetingConclusion);
  }

  // Optional Appendix: Full Transcript (English + Language Tag)
  if (includeTranscript && segments.length > 0) {
    doc.addPage();
    y = 52;
    addSectionHeading('Appendix: Full Meeting Transcript (English Translation)');
    for (const seg of segments) {
      ensureSpace(32);
      const sp = getSpeakerDisplayName(seg.speakerLabel, meeting.speakers);
      const header = `[${formatDuration(seg.startTime)} - ${formatDuration(seg.endTime)}] ${sp} (${seg.detectedLanguage})${seg.uncertain ? ' [Uncertain]' : ''}`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(29, 78, 216);
      doc.text(header, margin, y);
      y += 12;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      const engLines = doc.splitTextToSize(seg.englishTranslation || seg.originalText, contentWidth - 6);
      for (const l of engLines) {
        ensureSpace(14);
        doc.text(l, margin + 4, y);
        y += 13;
      }
      y += 6;
    }
  }

  // Footer page numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `MisMinutez — Every Language. Every Voice. One Clear Meeting Summary.`,
      margin,
      pageHeight - 24
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 52, pageHeight - 24);
  }

  const safeSlug = (meeting.title || 'meeting-minutes')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  doc.save(`misminutez-${safeSlug || 'report'}.pdf`);
}
