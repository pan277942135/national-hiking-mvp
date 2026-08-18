export type ValidationState =
  | 'REJECTED'
  | 'UNKNOWN'
  | 'SUPPORTED'
  | 'READY_FOR_TRACK_QA'
  | 'CANONICAL_CANDIDATE';

export interface ValidationDecision {
  gap_key: string;
  target_key?: string;
  state: ValidationState;
  confidence: number;
  accepted_record_count: number;
  reasons: string[];
  conflicts: string[];
  evidence_refs: string[];
}

export interface ValidationContext {
  now?: Date;
  targetKey?: string;
}

export type EvidenceRecord = Record<string, unknown>;

export interface EvidenceValidator {
  gapKey: string;
  validate(records: EvidenceRecord[], context?: ValidationContext): ValidationDecision;
}

function stringValue(record: EvidenceRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function recordRef(record: EvidenceRecord): string {
  return (
    stringValue(record, 'native_id') ||
    stringValue(record, 'track_id') ||
    stringValue(record, 'source_url') ||
    'unidentified-evidence'
  );
}

function ageDays(record: EvidenceRecord, now: Date): number {
  const value = stringValue(record, 'published_at') ||
    stringValue(record, 'recorded_or_published_at') ||
    stringValue(record, 'captured_at');
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return (now.getTime() - parsed.getTime()) / 86_400_000;
}

function sourceDescriptor(record: EvidenceRecord): string {
  return [
    stringValue(record, 'source_platform'),
    stringValue(record, 'operator_or_publisher'),
    stringValue(record, 'publisher'),
    stringValue(record, 'author')
  ].join(' ').toLowerCase();
}

function isHighAuthority(record: EvidenceRecord): boolean {
  const source = sourceDescriptor(record);
  return [
    '官方', 'gov', 'government', '中山陵园管理局', '景区', '运营方', 'operator', '管理处'
  ].some(token => source.includes(token.toLowerCase()));
}

function independenceKey(record: EvidenceRecord): string {
  const platform = stringValue(record, 'source_platform').toLowerCase();
  const author = (
    stringValue(record, 'author') ||
    stringValue(record, 'operator_or_publisher') ||
    stringValue(record, 'publisher') ||
    stringValue(record, 'native_id') ||
    stringValue(record, 'track_id') ||
    stringValue(record, 'source_url')
  ).toLowerCase();
  return `${platform}:${author}`;
}

function uniqueIndependent(records: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = independenceKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterTarget(records: EvidenceRecord[], context: ValidationContext | undefined, field: string): EvidenceRecord[] {
  if (!context?.targetKey) return records;
  const expected = context.targetKey.trim().toLowerCase();
  return records.filter(record => stringValue(record, field).toLowerCase() === expected);
}

function normalizeClaim(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，,。；;：:（）()]/g, '')
    .replace(/[–—~～]/g, '-');
}

function baseDecision(gapKey: string, context: ValidationContext | undefined): ValidationDecision {
  return {
    gap_key: gapKey,
    target_key: context?.targetKey,
    state: 'UNKNOWN',
    confidence: 0,
    accepted_record_count: 0,
    reasons: [],
    conflicts: [],
    evidence_refs: []
  };
}

const nightAccessValidator: EvidenceValidator = {
  gapKey: 'night_access_policy',
  validate(records, context) {
    const now = context?.now || new Date();
    const decision = baseDecision(this.gapKey, context);
    const scoped = filterTarget(records, context, 'access_point_name')
      .filter(record => stringValue(record, 'source_url'));

    const eligible = scoped.filter(record => {
      const explicitClaim =
        stringValue(record, 'claimed_opening_or_closing_time') ||
        stringValue(record, 'gate_or_barrier_observation');
      if (!explicitClaim) return false;
      return ageDays(record, now) <= (isHighAuthority(record) ? 365 : 90);
    });

    if (!eligible.length) {
      decision.reasons.push('No fresh explicit night-access evidence for target.');
      return decision;
    }

    const claims = new Map<string, EvidenceRecord[]>();
    for (const record of eligible) {
      const claim = normalizeClaim(
        stringValue(record, 'claimed_opening_or_closing_time') ||
        stringValue(record, 'gate_or_barrier_observation')
      );
      claims.set(claim, [...(claims.get(claim) || []), record]);
    }

    if (claims.size > 1) {
      decision.state = 'SUPPORTED';
      decision.confidence = 0.55;
      decision.accepted_record_count = eligible.length;
      decision.evidence_refs = eligible.map(recordRef);
      decision.conflicts = [...claims.keys()];
      decision.reasons.push('Conflicting fresh night-access claims must remain unresolved.');
      return decision;
    }

    const independent = uniqueIndependent(eligible);
    const hasAuthority = eligible.some(isHighAuthority);
    decision.accepted_record_count = independent.length;
    decision.evidence_refs = independent.map(recordRef);

    if (hasAuthority || independent.length >= 2) {
      decision.state = 'CANONICAL_CANDIDATE';
      decision.confidence = hasAuthority ? 0.9 : 0.78;
      decision.reasons.push(
        hasAuthority
          ? 'Fresh high-authority evidence contains an explicit access policy.'
          : 'Two independent recent observations agree on the access policy.'
      );
    } else {
      decision.state = 'SUPPORTED';
      decision.confidence = 0.58;
      decision.reasons.push('Only one non-authoritative recent observation is available.');
    }
    return decision;
  }
};

const parkingFeeValidator: EvidenceValidator = {
  gapKey: 'parking_fee_current',
  validate(records, context) {
    const now = context?.now || new Date();
    const decision = baseDecision(this.gapKey, context);
    const scoped = filterTarget(records, context, 'parking_name')
      .filter(record => stringValue(record, 'source_url'));

    const eligible = scoped.filter(record => {
      const fee = stringValue(record, 'fee_text_raw');
      if (!fee) return false;
      return ageDays(record, now) <= (isHighAuthority(record) ? 365 : 90);
    });

    if (!eligible.length) {
      decision.reasons.push('No fresh explicit parking-fee evidence for target.');
      return decision;
    }

    const claims = new Map<string, EvidenceRecord[]>();
    for (const record of eligible) {
      const claim = normalizeClaim(stringValue(record, 'fee_text_raw'));
      claims.set(claim, [...(claims.get(claim) || []), record]);
    }

    if (claims.size > 1) {
      decision.state = 'SUPPORTED';
      decision.confidence = 0.5;
      decision.accepted_record_count = eligible.length;
      decision.evidence_refs = eligible.map(recordRef);
      decision.conflicts = [...claims.keys()];
      decision.reasons.push('Conflicting current fee claims require reconciliation.');
      return decision;
    }

    const independent = uniqueIndependent(eligible);
    const hasAuthority = eligible.some(isHighAuthority);
    decision.accepted_record_count = independent.length;
    decision.evidence_refs = independent.map(recordRef);

    if (hasAuthority || independent.length >= 2) {
      decision.state = 'CANONICAL_CANDIDATE';
      decision.confidence = hasAuthority ? 0.92 : 0.8;
      decision.reasons.push(
        hasAuthority
          ? 'Current operator/official fee evidence is available.'
          : 'Two independent recent fee observations agree.'
      );
    } else {
      decision.state = 'SUPPORTED';
      decision.confidence = 0.6;
      decision.reasons.push('Single recent non-authoritative fee observation only.');
    }
    return decision;
  }
};

const routeGeometryValidator: EvidenceValidator = {
  gapKey: 'route_zj_s12_a_geometry',
  validate(records, context) {
    const decision = baseDecision(this.gapKey, context);
    const candidates = records.filter(record => {
      if (!stringValue(record, 'track_id') || !stringValue(record, 'source_url')) return false;
      const complete = record.is_complete_claim;
      if (complete === false || String(complete).toUpperCase() === 'FALSE') return false;
      return !!(
        stringValue(record, 'local_file_name_if_legitimate') ||
        stringValue(record, 'download_url_if_legitimate')
      );
    });

    const independent = uniqueIndependent(candidates);
    decision.accepted_record_count = independent.length;
    decision.evidence_refs = independent.map(recordRef);

    if (independent.length >= 2) {
      decision.state = 'READY_FOR_TRACK_QA';
      decision.confidence = 0.72;
      decision.reasons.push(
        'At least two independent candidate track files are available; metadata alone cannot promote geometry.'
      );
    } else if (records.length) {
      decision.state = 'SUPPORTED';
      decision.confidence = 0.4;
      decision.reasons.push('Candidate metadata exists, but fewer than two independent track files are available.');
    } else {
      decision.reasons.push('No route geometry candidate evidence available.');
    }
    return decision;
  }
};

export class ValidatorRegistry {
  private readonly validators = new Map<string, EvidenceValidator>();

  register(validator: EvidenceValidator): this {
    if (!validator.gapKey.trim()) throw new Error('validator.gapKey is required');
    this.validators.set(validator.gapKey, validator);
    return this;
  }

  get(gapKey: string): EvidenceValidator | undefined {
    return this.validators.get(gapKey);
  }

  validate(gapKey: string, records: EvidenceRecord[], context?: ValidationContext): ValidationDecision {
    const validator = this.validators.get(gapKey);
    if (!validator) {
      return {
        gap_key: gapKey,
        target_key: context?.targetKey,
        state: 'UNKNOWN',
        confidence: 0,
        accepted_record_count: 0,
        reasons: [`No validator registered for ${gapKey}.`],
        conflicts: [],
        evidence_refs: []
      };
    }
    return validator.validate(records, context);
  }
}

export function createDefaultValidatorRegistry(): ValidatorRegistry {
  return new ValidatorRegistry()
    .register(nightAccessValidator)
    .register(parkingFeeValidator)
    .register(routeGeometryValidator);
}
