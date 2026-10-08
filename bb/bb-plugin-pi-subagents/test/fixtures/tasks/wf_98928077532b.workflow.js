export const meta = {
  name: 'demo-repo-tour',
  description: 'Demo: map three areas of this repo in parallel, suggest one improvement each, then synthesize',
  phases: [
    { title: 'Map', detail: 'one reader per area, structured output' },
    { title: 'Suggest', detail: 'one improvement per area, runs as soon as its map is done' },
    { title: 'Synthesize', detail: 'single agent merges everything' },
  ],
}

const AREAS = args
const MAP_SCHEMA = {
  type: 'object',
  properties: {
    purpose: { type: 'string' },
    keyFiles: { type: 'array', items: { type: 'string' } },
  },
  required: ['purpose', 'keyFiles'],
}
const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: { suggestion: { type: 'string' }, file: { type: 'string' } },
  required: ['suggestion', 'file'],
}

log(`Touring ${AREAS.length} areas`)

const results = await pipeline(
  AREAS,
  area => agent(
    `Read-only. Look at the path "${area}" in the current repo. In 1-2 sentences say what it is for, and list up to 4 key files.`,
    { label: `map:${area}`, phase: 'Map', schema: MAP_SCHEMA, effort: 'low', agentType: 'Explore' }),
  (map, area) => map && agent(
    `Read-only. The area "${area}" is described as: ${map.purpose}\nKey files: ${map.keyFiles.join(', ')}\nSkim them and propose ONE small, concrete improvement.`,
    { label: `suggest:${area}`, phase: 'Suggest', schema: SUGGESTION_SCHEMA, effort: 'low', agentType: 'Explore' })
    .then(s => ({ area, ...map, ...s })),
)

const tour = results.filter(Boolean)
log(`${tour.length}/${AREAS.length} areas completed`)

phase('Synthesize')
const summary = await agent(
  `Write a 4-6 line overview of this repo from these area notes. No tools needed.\n${JSON.stringify(tour, null, 2)}`,
  { label: 'synthesize', effort: 'low' })

return { tour, summary }
