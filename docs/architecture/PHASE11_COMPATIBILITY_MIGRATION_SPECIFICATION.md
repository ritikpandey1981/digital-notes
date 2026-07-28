# Phase 11 — Compatibility & Migration Specification

Status: normative prerequisite for Phase 11 implementation  
Authority for current behavior: `FOLIO_ARCHITECTURE_REFERENCE_MANUAL.md`  
Scope: the six compatibility decisions below only

Phase 11 extends the existing `@folio/history` package; it does not create a replacement package. The package will contain two clearly separated public surfaces:

- the accepted Phase 5 notebook-history compatibility surface; and
- the Phase 11 generic editor-history surface.

The existing surface remains available to current consumers. The active editor will use only the Phase 11 surface and will have one Phase 11 history manager per editor session. Legacy snapshot, persistence, and notebook-validation behavior does not become part of the Phase 11 surface.

## 1. Snapshot Strategy

### Current implementation

History entries retain exact immutable `@folio/domain` `Notebook` references for their before and after states. Built-in commands are created through an internal snapshot-command mechanism, and a committed transaction is represented by another snapshot command. Undo and redo restore those retained aggregate references.

`HistorySnapshot` itself is lightweight: it exposes the current notebook reference and history revision without cloning the notebook.

### Phase 11 requirement

Phase 11 requires commands to produce immutable successors during execute, undo, and redo. It prohibits snapshot storage and snapshot restoration, requires document copies to be avoided, and permits immutable references to be reused.

### Conflict

The phrase “reuse immutable references” does not make the current before/after entry strategy compatible. The conflict is not immutability; it is retaining complete aggregate states as the reversal mechanism and restoring them during undo or redo.

### Migration strategy

For Phase 11, a **snapshot** means a retained complete before/after aggregate state—whether deep-copied or referenced—used to implement reversal. Phase 11 commands may hold minimal immutable command data and may receive or return immutable document references. History may also expose the current immutable document reference as state. It may not retain complete before/after document aggregates in history entries for reversal.

The Phase 5 notebook-history surface keeps its existing reference-based behavior for compatibility. The new editor-history surface does not use its snapshot-command mechanism.

### Final architectural decision

Immutable aggregate references are allowed as active state, command inputs/results, notifications, and lightweight state views. They are not allowed as stored before/after reversal snapshots in Phase 11 history entries. “No snapshots” prohibits both deep copies and retained whole-aggregate references when either is used as the undo/redo mechanism.

**Existing-code disposition:** the Phase 5 snapshot behavior remains unchanged on the compatibility surface. The package is extended with a snapshot-free Phase 11 surface. Existing snapshot machinery is not reused or expanded for editor history.

## 2. History and Persistence

### Current implementation

`@folio/history` declares a production dependency on `@folio/persistence`. `HistoryManager` accepts an optional `DirtyTracker`, marks metadata/section/page targets, clears that tracker at the save point, and exposes intrinsic dirty state by comparing the current notebook reference with the saved notebook reference.

### Phase 11 requirement

History and Persistence must be independent. Phase 11 does not implement persistence or autosave, and editor history must not own persistence coordination.

### Conflict

The direct package/type dependency and direct `DirtyTracker` calls violate the Phase 11 boundary. The existing history-level save-point and dirty-state concepts do not themselves violate that boundary; the conflict is History knowing and invoking a Persistence implementation.

### Migration strategy

The direct `@folio/history` → `@folio/persistence` dependency will be removed. Persistence coordination will be owned by the application/editor composition boundary, using Phase 11 history state and notifications. The Phase 11 manager will not accept or invoke `DirtyTracker`.

The Phase 5 `HistoryManager` will preserve source-compatible optional dirty-tracker behavior through a history-owned compatibility contract that the existing tracker can satisfy structurally. This compatibility contract creates no package import and is not part of the Phase 11 editor-history surface. Existing save-point and `isDirty` behavior remains available to legacy consumers.

### Final architectural decision

History has no production dependency on Persistence. Phase 11 history reports history state; an external coordinator decides how that state affects persistence dirty tracking and save completion. The legacy manager may continue accepting a compatible injected dirty sink, but neither the generic manager nor its public abstractions know `DirtyTracker` or persistence targets.

**Existing-code disposition:** the history package manifest, imported type boundary, and legacy option typing must be modified to remove the direct dependency while preserving legacy runtime behavior. Phase 11 persistence coordination is added outside History. Persistence internals remain unchanged.

## 3. Domain Validation

### Current implementation

The current manager validates command structure and metadata, then validates every command result as a valid, deeply frozen `Notebook`. Built-in commands also invoke domain aggregate operations and enforce exact-reference lifecycle rules. History also understands persistence-oriented affected targets.

### Phase 11 requirement

History validates only history concerns: command lifecycle, execution state, stack state, transaction state, and the success or failure of the command protocol. Concrete editor commands validate all document and operation semantics.

### Conflict

The current manager knows the `Notebook` model and inspects domain results. Applying the same behavior to editor history would make History responsible for document semantics and would prevent it from remaining generic.

### Migration strategy

The Phase 11 surface will separate protocol validation from domain validation. History owns only whether an operation is legal in its current lifecycle and whether a command reports a valid protocol-level outcome. A concrete command owns document references, object identifiers, page/layer ownership, visibility or locking rules, document revision requirements, required objects, command invariants, and the validity and immutability of the successor it produces.

The existing notebook manager retains its current validation because removing it would change accepted Phase 5 behavior. Those checks are not shared with or generalized into the Phase 11 manager.

### Final architectural decision

History validates orchestration; commands validate meaning. History treats a command’s domain failure as opaque and preserves consistent history state without interpreting the cause.

**Existing-code disposition:** existing notebook validation remains unchanged on the compatibility surface. The package is extended with a generic Phase 11 validation boundary. No validation responsibility moves into `@folio/domain` or `@folio/document` beyond what those packages and concrete commands already own.

## 4. Domain Model Compatibility

### Current implementation

The Phase 5 history system operates exclusively on immutable `@folio/domain` `Notebook` aggregates. Persistence uses the same model. The interactive editor separately owns an `@folio/document` object collection and currently has no integration with notebook history. The two packages represent different bounded models and are not interchangeable.

### Phase 11 requirement

Phase 11 history must support editor commands over immutable document successors without depending on editing-system implementations. Editor owns the adaptation from an immutable editing result, such as a manipulation commit, to a concrete command.

### Conflict

Generalizing the existing `Notebook`-fixed manager in place would break its accepted API and still would not define how the editor’s document model participates. Treating `Notebook` and the document object collection as the same aggregate would contradict the current architecture.

### Migration strategy

The two models remain separate. `Notebook` remains the storage/domain aggregate for the existing Phase 5 history and persistence flows. The Phase 11 history abstraction is state-agnostic and does not import either model. Editor-owned concrete commands operate on the `@folio/document` session model and satisfy the public command contract owned by History.

No `Notebook` ↔ document adapter is introduced in Phase 11. Editor command adaptation converts editing-system results into commands; it does not convert between the two aggregate models. Any future persistence mapping between these models is outside this specification and outside Phase 11.

### Final architectural decision

`Notebook` is retained unchanged. The editor continues using `@folio/document`. Phase 11 generalizes only the new history execution contract, not either domain model and not the existing notebook manager. Both models coexist behind separate consumers in the same repository.

**Existing-code disposition:** `@folio/domain`, `@folio/document`, and the current notebook manager remain unchanged. `@folio/history` is extended with a model-neutral editor-history surface, and `@folio/editor` is extended only as the coordinator and owner of concrete editor commands.

## 5. Public API Compatibility

### Current implementation

`HistoryManager` is a public concrete class. `Command`, history state/error types, transaction types, and ten notebook/section/page command factories are public exports.

### Phase 11 requirement

Phase 11 calls for stable public interfaces, private concrete implementations, factory-based construction, a controller boundary for Editor, and the public `EditorCommand` abstraction.

### Conflict

Making the existing class or command factories private would break an accepted public API. Making the new Phase 11 concrete manager public would conflict with the new interface/factory boundary.

### Migration strategy

Existing public exports are frozen as the Phase 5 compatibility API and will not be removed, renamed, or made private. New Phase 11 exports will be additive and limited to stable interfaces, immutable public state/types, errors required by callers, and construction factories. New manager/controller implementation classes remain private. Editor uses the new controller/factory surface rather than directly constructing an implementation.

The existing concrete `HistoryManager` remains public only because it is already part of the accepted API; it does not establish a precedent for exposing new implementations. Existing notebook command factories remain public and remain scoped to the notebook compatibility surface.

### Final architectural decision

Public API compatibility takes precedence for existing exports, while the Phase 11 interface-first rule governs every new export. New APIs are added beside the old APIs; existing APIs are not replaced.

**Existing-code disposition:** current exports remain unchanged except for the persistence-decoupling type adjustment defined in Section 2. The package barrel is extended with the Phase 11 interfaces and factories. New implementation classes and helpers remain private.

## 6. Transactions

### Current implementation

Transactions are non-nested. Commands collected during a transaction become one undo entry at commit through a snapshot command holding the transaction’s starting and final notebook references. Rollback reverses the collected child commands. Transaction merging is not supported.

### Phase 11 requirement

Phase 11 preserves the accepted transaction architecture and adds no transaction capabilities. At the same time, Phase 11 prohibits snapshot storage/restoration and requires command-based immutable successors for undo and redo.

### Conflict

The current external transaction behavior is compatible, but its committed snapshot-command representation is not compatible with the Phase 11 no-snapshot rule.

### Migration strategy

Phase 11 preserves the transaction contract: non-nested grouping, explicit begin/commit/rollback, one committed undo unit, child ordering, and no merging. On the Phase 11 surface, the committed unit retains the ordered child commands and transaction metadata rather than complete starting/final document aggregates. It remains a command group, not a document snapshot.

The Phase 5 manager continues using its existing snapshot-command transaction representation for compatibility. The two representations are internal to their respective surfaces and are not interchangeable.

### Final architectural decision

The existing transaction semantics remain authoritative; the existing snapshot representation is not authoritative for Phase 11. Phase 11 transactions are grouped command history with no stored whole-document before/after state.

**Existing-code disposition:** the Phase 5 transaction implementation remains unchanged. The package is extended with a snapshot-free transaction representation for the Phase 11 manager. No nested transactions, merging, or other transaction capabilities are added.
