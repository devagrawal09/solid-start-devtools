import { formatOrigin } from 'solid-js/attribution';
import { concernOf, type AsyncRecord } from '../async/tracker.js';
import { code } from './markdown.js';
import { isSensitiveName, REDACTED, redactText, redactUrl } from './redact.js';
import { ms } from './timeline-report.js';

export interface AsyncReportInput {
  record: AsyncRecord;
  /** The path and query of the page. */
  route: string;
}

/** The title of a record, as the panel lists it. */
export function asyncTitle(record: AsyncRecord): string {
  switch (record.type) {
    case 'load':
      return `load ${record.event.nodeName}`;
    case 'wait':
      return `wait on ${record.event.blockers.join(', ') || 'async work'}`;
    case 'fallback':
      return `fallback at ${record.event.ownerPath?.join(' › ') ?? 'a Loading boundary'}`;
    case 'chain':
      return `chain ${record.event.chain.map((link) => link.name).join(' → ')}`;
  }
}

/** How long a record took, as the panel lists it. */
export function asyncDuration(record: AsyncRecord): number {
  switch (record.type) {
    case 'load':
      return record.event.durationMs;
    case 'wait':
      return record.event.holdMs;
    case 'fallback':
      return record.event.shownMs;
    case 'chain':
      return record.event.sequentialMs;
  }
}

function details(record: AsyncRecord): string[] {
  const out: string[] = [];
  switch (record.type) {
    case 'load': {
      const { event } = record;
      out.push(`- Outcome: ${event.outcome === 'landed' ? 'landed' : 'replaced by a newer load'}`);
      if (event.ownerPath?.length) out.push(`- Owner path: ${code(event.ownerPath.join(' > '))}`);
      break;
    }
    case 'wait': {
      const { event } = record;
      out.push(`- Waited on: ${event.blockers.map(code).join(', ') || 'unknown'}`);
      out.push(`- Quiet tail: ${ms(event.tailMs)} after the last write that joined`);
      if (event.heldWrites.length) {
        out.push('- Held writes:');
        for (const write of event.heldWrites) {
          const values = isSensitiveName(write.name)
            ? ` ${REDACTED}`
            : write.value === undefined
              ? ''
              : ` ${write.prev === undefined ? '' : `${redactText(write.prev)} → `}${redactText(write.value)}`;
          out.push(`  - ${code(write.name)}${values}`);
        }
      }
      if (event.acknowledgements.length) {
        out.push('- Pending state shown by:');
        for (const ack of event.acknowledgements) {
          const reader = ack.reader?.length ? ` in ${code(ack.reader.join(' > '))}` : '';
          out.push(`  - ${ack.kind} of ${code(ack.source)}${reader}`);
        }
      } else {
        out.push('- Pending state shown by: nothing, the screen did not change while it waited');
      }
      break;
    }
    case 'fallback': {
      const { event } = record;
      if (event.ownerPath?.length) out.push(`- Boundary: ${code(event.ownerPath.join(' > '))}`);
      break;
    }
    case 'chain': {
      out.push('- Loads, in order:');
      for (const link of record.event.chain) out.push(`  - ${code(link.name)} ${ms(link.ms)}`);
      out.push('- Each load started only after the one before it landed.');
      break;
    }
  }
  return out;
}

/** The action a record traces back to, if the runtime knows it. */
export function asyncOrigin(record: AsyncRecord): string | undefined {
  const origin = record.type === 'chain' ? undefined : record.event.interaction;
  return origin ? formatOrigin(origin) : undefined;
}

/** A Markdown report of one async record, for an agent to read. */
export function asyncReport(input: AsyncReportInput): string {
  const { record } = input;
  const out: string[] = [`# Solid async: ${code(asyncTitle(record))}`, ''];
  out.push(`- Page: ${code(redactUrl(input.route))}`);
  out.push(`- Took: ${ms(asyncDuration(record))}`);
  const origin = asyncOrigin(record);
  if (origin) out.push(`- Started by: ${code(origin)}`);
  const concern = concernOf(record);
  if (concern) out.push(`- Concern: ${concern}`);
  out.push(...details(record));
  return out.join('\n');
}
