# Proposal 0008: DELETE /variants/{id} on the content contract

Status: PROPOSED (implemented in service, awaiting contract ratification). No em dashes.

## Why

Authors need to remove a variant (an uploaded or registered cut) from a beat: a wrong take, a failed encode, or
a placeholder. The Studio Media panel now exposes a per-row Remove control, but the frozen content contract
(`contracts/api/content.yaml`) documents only `POST /variants`. Per the frozen-boundary invariant ("do not edit
`contracts/` without orchestrator sign-off; if a UI need requires a contract change, stop and raise it"), this
proposal raises the addition rather than editing the frozen spec directly.

## The change

Add a delete operation under the existing `/variants` path:

```yaml
  /variants/{variant_id}:
    delete:
      operationId: deleteVariant
      summary: "Remove a beat_variant by id. Idempotent at the API: a present id returns 200, an absent one 404."
      parameters:
        - { name: variant_id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200': { description: "Deleted.", content: { application/json: { schema: { type: object, required: [id, deleted], properties: { id: { type: string, format: uuid }, deleted: { type: boolean, enum: [true] } } } } } }
        '400': { description: "Malformed id (invalid_variant_id).", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
        '404': { description: "No variant with that id (variant_not_found).", content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
```

## What is already implemented (service-ahead-of-contract, flagged)

- `services/content/src/content.ts`: `handleDeleteVariant` (uuid guard, 404 on absent) + `ContentDB.deleteVariant`.
- `services/content/src/pgContentDb.ts` and `services/content/test/harness.ts`: `deleteVariant` (DELETE ... RETURNING id).
- `services/content/src/http/app.ts`: `app.delete("/variants/:id", ...)`.
- `services/content/test/http.test.ts`: route tests (200 then idempotent 404; malformed id 400).
- Studio client `deleteVariant(id)`; Media panel Remove button; `apps/studio/src/api/media.ts` `deleteMedia(url)`
  prunes the encoded bytes on the local media server (`DELETE /media/{id}`, also new, local tool not a contract).

## Open questions for ratification

1. **Referential safety.** A hard delete is fine for fresh authoring content. In production a variant may be
   referenced by `decision_log.next_variant_id` (a separate off-policy log) or unlocked via the economy
   (`scope=beat_variant`). Decide: hard delete + tolerate orphan log rows, OR soft delete (needs a
   `deleted_at` column = a supabase migration = a separate STOP-gated proposal), OR refuse (409) when an
   economy unlock exists for the variant.
2. **Authoring authorization.** These authoring routes carry no auth today (per the contract note). Deletion is
   destructive; confirm whether author-role gating is required before this ships beyond local dev.
3. **Cascade to edges.** `beat_edges` reference beats, not variants, so no edge cascade is needed. Confirm.

Until ratified, the service exposes the endpoint ahead of the documented contract. Ratify by folding the YAML
above into `contracts/api/content.yaml` (W0) and regenerating the contract types.
