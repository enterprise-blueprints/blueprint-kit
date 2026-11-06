// The element types and relationship predicates the library knows how to
// publish. A package that uses anything else fails validation, so adding a
// type or predicate means adding it here first, with its labels.

export interface ElementTypeInfo {
  label: string;
  plural: string;
  /** Shorter label for the site navigation. */
  navLabel: string;
  /** URL section, as in /capabilities/<slug>/. */
  section: string;
  definition: string;
}

export const elementTypes: Record<string, ElementTypeInfo> = {
  mission: {
    label: 'Mission',
    plural: 'Missions',
    navLabel: 'Missions',
    section: 'missions',
    definition: 'An enduring public purpose or organizational responsibility.',
  },
  outcome: {
    label: 'Outcome',
    plural: 'Outcomes',
    navLabel: 'Outcomes',
    section: 'outcomes',
    definition: 'A result a mission seeks: the change in the world that shows the work is paying off.',
  },
  // Packages before schema 0.4.0 only. Since then, measures are part of their outcome.
  measure: {
    label: 'Measure',
    plural: 'Measures',
    navLabel: 'Measures',
    section: 'measures',
    definition: 'A way to tell how an outcome is going, such as a figure an office already reports.',
  },
  capability: {
    label: 'Capability',
    plural: 'Capabilities',
    navLabel: 'Capabilities',
    section: 'capabilities',
    definition: 'An ability an organization needs or has: what must be possible.',
  },
  requirement: {
    label: 'Requirement',
    plural: 'Requirements',
    navLabel: 'Requirements',
    section: 'requirements',
    definition: 'A condition or behavior that must be true: what a capability has to do or respect.',
  },
  implementationPattern: {
    label: 'Implementation pattern',
    plural: 'Implementation patterns',
    navLabel: 'Patterns',
    section: 'patterns',
    definition: 'An example approach that might realize a capability.',
  },
  // Since schema 0.6.0.
  resource: {
    label: 'Resource',
    plural: 'Resources',
    navLabel: 'Resources',
    section: 'resources',
    definition: 'Something that helps you learn about an item or act on it, such as a video, a course, or a guide.',
  },
  // Since schema 0.7.0, what implements a pattern: a product, a platform the
  // agency has, a shared service, or something built. Before schema 0.4.0, an
  // example of several patterns together, which a mission's own patterns
  // replaced; its `includes` reads as `implements`.
  solution: {
    label: 'Solution',
    plural: 'Solutions',
    navLabel: 'Solutions',
    section: 'solutions',
    definition: 'An example of how a pattern could be sourced: a product, a platform the agency has, a shared service, or something built.',
  },
};

export interface PredicateInfo {
  from: string[];
  to: string[];
  /** Heading on the "from" element's page, listing the "to" elements. */
  outgoing: string;
  /** Heading on the "to" element's page, listing the "from" elements. */
  incoming: string;
}

export const predicates: Record<string, PredicateInfo> = {
  seeks: {
    from: ['mission'],
    to: ['outcome'],
    outgoing: 'Outcomes it seeks',
    incoming: 'Missions that seek it',
  },
  contributes_to: {
    from: ['capability'],
    to: ['outcome'],
    outgoing: 'Outcomes it contributes to',
    incoming: 'Capabilities that contribute to it',
  },
  measured_by: {
    from: ['outcome'],
    to: ['measure'],
    outgoing: 'Measures',
    incoming: 'Outcomes it measures',
  },
  // Package 0.1.0 links capabilities straight to the mission. Later versions
  // go through the outcomes the mission seeks.
  supports_mission: {
    from: ['capability'],
    to: ['mission'],
    outgoing: 'Missions it supports',
    incoming: 'Capabilities that support it',
  },
  satisfies: {
    from: ['capability'],
    to: ['requirement'],
    outgoing: 'Reference requirements',
    incoming: 'Capabilities that satisfy it',
  },
  candidate_pattern: {
    from: ['capability'],
    to: ['implementationPattern'],
    outgoing: 'Candidate implementation patterns',
    incoming: 'Capabilities it might help realize',
  },
  // Since schema 0.7.0: the patterns a solution sources. One platform can implement several.
  implements: {
    from: ['solution'],
    to: ['implementationPattern'],
    outgoing: 'Implements',
    incoming: 'Solutions',
  },
  includes: {
    from: ['solution'],
    to: ['implementationPattern'],
    outgoing: 'Patterns it includes',
    incoming: 'Solutions that include it',
  },
  supports: {
    from: ['solution'],
    to: ['mission'],
    outgoing: 'Missions it supports',
    incoming: 'Example solutions',
  },
  // How patterns fit together, since schema 0.3.0: one can't work without
  // the other, or the two are often used together. Since schema 0.7.0, a
  // solution can need a pattern too, a need of that solution only.
  depends_on: {
    from: ['implementationPattern', 'solution'],
    to: ['implementationPattern'],
    outgoing: 'Needs',
    incoming: 'Needed by',
  },
  works_with: {
    from: ['implementationPattern'],
    to: ['implementationPattern'],
    outgoing: 'Works well with',
    incoming: 'Works well with',
  },
  // Since schema 0.6.0: what a resource helps with. Before schema 0.7.0, a
  // link to a pattern can name one of its ways; since then, a resource about
  // one way of sourcing a pattern helps with that solution.
  helps_with: {
    from: ['resource'],
    to: ['mission', 'outcome', 'capability', 'requirement', 'implementationPattern', 'solution'],
    outgoing: 'Helps with',
    incoming: 'Resources',
  },
};

// An implementation pattern describes itself in `attributes`, with these
// fields, so patterns can be compared side by side and grouped by the layer of
// a mission's architecture they belong to, which the `layer` field names
// (`role` before schema 0.4.0). A solution in an older package uses watchFor
// too. The layers are in the order the pages show them, and each hint says
// what belongs in it.
export const patternLayers: Record<string, { label: string; hint: string }> = {
  'public-facing': {
    label: 'Public facing',
    hint: 'How the public, applicants, vendors, and other agencies reach the office or find what it publishes.',
  },
  'ai-insights': {
    label: 'AI and insights',
    hint: 'Reporting, analytics, and AI that turn the office’s records into insight and suggestions, for staff to act on.',
  },
  'business-applications': {
    label: 'Business applications',
    hint: 'The system of record for each kind of work, where it’s tracked and done.',
  },
  'worker-productivity': {
    label: 'Worker productivity',
    hint: 'What staff write, collaborate, and draft in, alongside the business applications.',
  },
  connections: {
    label: 'Connections',
    hint: 'Exchanges with government-wide services and other agencies’ systems, such as SAM.gov, Grants.gov, and Treasury’s.',
  },
  'data-records': {
    label: 'Data and records',
    hint: 'Where the office’s records and content are stored, searched, and kept on their schedules.',
  },
  'security-identity': {
    label: 'Security and identity',
    hint: 'Who gets into each system, and a watch on what they do there, under everything else.',
  },
};

/** Layers that packages before schema 0.4.0 use too. Their patterns moved to the layers above. */
export const earlierLayers: Record<string, { label: string; hint: string }> = {
  processing: {
    label: 'Processing service',
    hint: 'Specialized processing on the records, such as search and review.',
  },
  infrastructure: {
    label: 'Infrastructure',
    hint: 'Shared services every system relies on, such as sign-on.',
  },
};

// Since schema 0.5.0, outcomes, capabilities, and requirements each name one
// group in `attributes`, from these lists, so the index pages can group them
// across missions. The groups are broad enough for missions to come: a new
// mission's items fit the groups there are, and a new group is added here.
// Each list is in the order the pages show it, and each hint says what belongs.
export interface Grouping {
  /** The attribute that names the group. */
  field: string;
  /** What a group is called, as in "Stage of the work". */
  label: string;
  groups: Record<string, { label: string; hint: string }>;
}

export const outcomeThemes: Grouping = {
  field: 'theme',
  label: 'What the public gets',
  groups: {
    timely: { label: 'Timely', hint: 'Things happen when they should, and backlogs don’t pile up.' },
    'fair-accessible': { label: 'Fair and accessible', hint: 'Open to everyone eligible, and judged on the stated rules.' },
    'easy-to-use': { label: 'Easy to use', hint: 'People can find, use, and get help with the service.' },
    integrity: { label: 'Integrity', hint: 'Money and authority go to the right hands, and fraud is prevented.' },
    results: { label: 'Results', hint: 'The mission achieves its purpose, economically.' },
    accountable: { label: 'Accountable', hint: 'Decisions hold up, problems get fixed, and concerns can be raised safely.' },
    transparent: { label: 'Transparent', hint: 'The work and the spending are open to view.' },
  },
};

export const capabilityStages: Grouping = {
  field: 'stage',
  label: 'Stage of the work',
  groups: {
    'plan-prepare': { label: 'Plan and prepare', hint: 'Setting direction, programs, rules, and readiness.' },
    'reach-take-in': { label: 'Reach and take in', hint: 'Telling people what’s offered, and taking in requests, applications, reports, and data.' },
    'assess-decide': { label: 'Assess and decide', hint: 'Reviewing, evaluating, investigating, and determining.' },
    'deliver-operate': { label: 'Deliver and operate', hint: 'Providing the service, paying, and running the operation.' },
    'monitor-correct': { label: 'Monitor and correct', hint: 'Watching how things go, enforcing, and resolving disputes and appeals.' },
    'report-close': { label: 'Report and close', hint: 'Closing out, publishing, reporting, and learning.' },
    'across-the-work': { label: 'Across the work', hint: 'Shared foundations any mission uses.' },
  },
};

export const requirementKinds: Grouping = {
  field: 'kind',
  label: 'Kind of obligation',
  groups: {
    timeliness: { label: 'Timeliness', hint: 'Deadlines, time standards, and schedules.' },
    'checks-controls': { label: 'Checks and controls', hint: 'Eligibility and identity checks, conflicts of interest, approvals, and payment holds.' },
    'decisions-on-record': { label: 'Decisions on the record', hint: 'Documenting what was decided and why, and keeping it.' },
    'privacy-security': { label: 'Privacy and security', hint: 'Protecting information, people’s identities, and access to them.' },
    'transparency-reporting': { label: 'Transparency and reporting', hint: 'Publishing, posting, and reporting to oversight bodies.' },
    'service-access': { label: 'Service and access', hint: 'Notices, help, status, plain language, and access for people with disabilities or limited English.' },
    'fairness-due-process': { label: 'Fairness and due process', hint: 'Stated criteria, equal treatment, and rights to appeal, challenge, or be heard.' },
  },
};

// Since schema 0.6.0. The library's own resources are free, from government,
// standards bodies, nonprofits, and universities, so it doesn't use the kinds
// for what's sold: services and products belong in their publishers' packages.
export const resourceKinds: Grouping = {
  field: 'kind',
  label: 'Kind of resource',
  groups: {
    video: { label: 'Video', hint: 'Recorded talks, walkthroughs, and explainers.' },
    course: { label: 'Course', hint: 'Training, on demand or scheduled.' },
    guide: { label: 'Guide', hint: 'Handbooks, playbooks, and how-tos.' },
    site: { label: 'Site', hint: 'Program sites and portals to know.' },
    community: { label: 'Community', hint: 'Councils, communities of practice, and forums.' },
    dataset: { label: 'Dataset', hint: 'Data to explore, compare, or build on.' },
    tool: { label: 'Tool', hint: 'Free tools, calculators, and open-source software.' },
    template: { label: 'Template', hint: 'Templates, samples, and checklists to start from.' },
    demo: { label: 'Demo', hint: 'A working example to see or try.' },
    service: { label: 'Service', hint: 'Help an organization offers, such as an assessment or an implementation.' },
    // Before schema 0.7.0. Since then, a product is a solution.
    product: { label: 'Product', hint: 'A product, or a feature of one, that fits.' },
    'case-study': { label: 'Case study', hint: 'How an agency did it, and what it learned.' },
  },
};

/** Kinds the library's own resources don't use. */
export const soldKinds = ['service', 'product'];

/** Resource kinds packages no longer use: since schema 0.7.0, a product is a solution. */
export const retiredKinds = ['product'];

// Since schema 0.7.0, each solution names its approach, how it sources its
// patterns, so the index can group them and a pattern's solutions can be
// compared. The library's own are examples; organizations publish products.
export const solutionApproaches: Grouping = {
  field: 'approach',
  label: 'Approach',
  groups: {
    product: { label: 'Configure a product', hint: 'A product, configured for the agency.' },
    platform: { label: 'Extend a platform the agency has', hint: 'A platform the agency already runs, such as its low-code platform or its office suite.' },
    shared: { label: 'Use a shared service', hint: 'A service another agency runs for others, such as Login.gov or a payroll provider.' },
    combine: { label: 'Combine tools', hint: 'Tools put together, each doing part of the work.' },
    build: { label: 'Build to fit', hint: 'Something the agency builds, or has built, to fit.' },
  },
};

// Since schema 0.8.0, a solution can list its components, the parts that run
// separately, each in a tier, and say who hosts it.
export const componentTiers: Record<string, { label: string; hint: string }> = {
  front: { label: 'Front', hint: 'What people use, such as portals, forms, and apps' },
  service: { label: 'Service', hint: 'Logic, workflows, APIs, and integration' },
  data: { label: 'Data', hint: 'Databases, document stores, and warehouses' },
};

export const hostings: Record<string, { label: string; hint: string }> = {
  vendor: { label: 'Hosted by its maker', hint: 'Its maker runs it as a service.' },
  agency: { label: 'Run by the agency', hint: 'The agency runs it, in its own hosting.' },
  provider: { label: 'Run by another agency', hint: 'Another agency runs it as a shared service.' },
};

export const exposures: Record<string, string> = {
  public: 'Public-facing',
  internal: 'Internal',
};

/** The grouping each type uses, by element type. */
export const groupings: Record<string, Grouping> = {
  outcome: outcomeThemes,
  capability: capabilityStages,
  requirement: requirementKinds,
  resource: resourceKinds,
  solution: solutionApproaches,
};

/** What a resource holds besides its kind, written on it and published in its attributes. A solution can have them too. */
export const resourceFields = ['url', 'by', 'lastReviewedAt'];

/** The types that can say where to find them, who made them, and when that was checked. */
export const linkedTypes = ['resource', 'solution'];

/** The ID prefix of packages that don't name one, before schema 0.6.0: the library's own. */
export const libraryPrefix = 'eb';

export const patternApproaches: Record<string, string> = {
  product: 'Configure a product',
  platform: 'Extend a platform the agency has',
  shared: 'Use a shared service',
  combine: 'Combine tools',
  build: 'Build to fit',
};

export const patternFields: Record<string, { label: string; definition: string }> = {
  parts: { label: 'What it’s made of', definition: 'The main pieces of the pattern.' },
  strengths: { label: 'Strengths', definition: 'What the pattern does well.' },
  fitsWhen: { label: 'Fits when', definition: 'Situations where the pattern is a good fit.' },
  watchFor: { label: 'Watch for', definition: 'Tradeoffs and risks to plan for.' },
};

export const sourceKinds: Record<string, string> = {
  'official-reference': 'Official reference',
  research: 'Research',
  background: 'Background',
  other: 'Other',
};

export const statuses: Record<string, string> = {
  reference: 'Reference',
  draft: 'Draft',
  deprecated: 'Deprecated',
};
