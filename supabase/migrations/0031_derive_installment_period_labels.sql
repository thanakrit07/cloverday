-- ADR-0016: a posted installment period's label is derived at render time from
-- its plan and its own `source_key`, not stored. `note` goes back to being the
-- user's column alone.
--
-- Every period until now carried "<plan name> (งวดที่ n/total)" written into
-- `note` by the materialiser. Two of them were still quoting a name their plan
-- had not held for days, because a stored label has to be propagated and a
-- propagation can miss; a derived one cannot drift by construction. Leaving the
-- old text in place would print it a second time under the composed label, so
-- it is cleared here.
--
-- Nothing is lost. A cleared note is exactly reproducible from `installments`
-- plus the row's `source_key` -- which is the property that makes deriving it
-- correct in the first place -- and the match is anchored at both ends, so a
-- row is only touched when its note is *entirely* a generated label.
--
-- The period number inside the label must equal the one in `source_key`: that
-- is what a note merely resembling a label would fail. Soft-deleted rows are
-- included deliberately, so restoring one does not bring a stale name back.
update transactions
set note = null
where source = 'installment'
  and note is not null
  and source_key ~ '^installment:[^:]+:[0-9]+$'
  and note ~ ('^.* \(งวดที่ ' || split_part(source_key, ':', 3) || '/[0-9]+\)$');
