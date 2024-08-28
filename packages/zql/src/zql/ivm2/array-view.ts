import {Change} from './change.js';
import {Row, Comparator, Value} from './data.js';
import {Input, Output} from './operator.js';
import {assert} from 'shared/src/asserts.js';
import {Schema} from './schema.js';
import {must} from 'shared/src/must.js';
import {Immutable} from 'shared/src/immutable.js';
import {SubscriptionDelegate} from '../context/context.js';
import {AST} from '../ast2/ast.js';

/**
 * Called when the view changes. The received data should be considered
 * immutable. Caller must not modify it. Passed data is valid until next
 * time listener is called.
 */
export type Listener = (
  entries: Immutable<EntryList>,
  resultType: ResultType,
) => void;
export type ResultType = 'complete' | 'partial' | 'none';

/**
 * Implements a materialized view of the output of an operator.
 *
 * It might seem more efficient to use an immutable b-tree for the
 * materialization, but it's not so clear. Inserts in the middle are
 * asymptotically slower in an array, but can often be done with zero
 * allocations, where changes to the b-tree will often require several allocs.
 *
 * Also the plain array view is more convenient for consumers since you can dump
 * it into console to see what it is, rather than having to iterate it.
 */
export class ArrayView implements Output {
  readonly #input: Input;
  readonly #view: EntryList;
  readonly #listeners = new Set<Listener>();
  readonly #schema: Schema;
  readonly #subscriptionDelegate: SubscriptionDelegate;
  readonly #ast: AST;

  #hydrated = false;
  #resultType: ResultType = 'none';

  constructor(
    subscriptionDelegate: SubscriptionDelegate,
    ast: AST,
    input: Input,
  ) {
    this.#input = input;
    this.#schema = input.getSchema();
    this.#subscriptionDelegate = subscriptionDelegate;
    this.#ast = ast;

    this.#input.setOutput(this);
    this.#view = [];
  }

  get data() {
    return this.#view;
  }

  // Need the host so we can call `subscriptionAdded`
  addListener(listener: Listener) {
    assert(!this.#listeners.has(listener), 'Listener already registered');

    const subscriptionRemoved = this.#subscriptionDelegate.subscriptionAdded(
      this.#ast,
      got => {
        if (got) {
          this.#resultType = 'complete';
        }
        if (this.#hydrated) {
          listener(this.#view, this.#resultType);
        }
      },
    );

    this.#listeners.add(listener);
    if (this.#hydrated) {
      listener(this.#view, this.#resultType);
    }

    return () => {
      subscriptionRemoved();
      this.#listeners.delete(listener);
    };
  }

  #fireListeners() {
    if (this.#resultType === 'none') {
      this.#resultType = 'partial';
    }
    for (const listener of this.#listeners) {
      listener(this.#view, this.#resultType);
    }
  }

  destroy() {
    this.#input.destroy();
  }

  hydrate() {
    if (this.#hydrated) {
      throw new Error("Can't hydrate twice");
    }
    this.#hydrated = true;
    for (const node of this.#input.fetch({})) {
      applyChange(this.#view, {type: 'add', node}, this.#schema);
    }
    this.#fireListeners();
  }

  push(change: Change): void {
    applyChange(this.#view, change, this.#schema);
    this.#fireListeners();
  }
}

export type EntryList = Entry[];
export type Entry = Record<string, Value | EntryList>;

function applyChange(view: EntryList, change: Change, schema: Schema) {
  if (change.type === 'add') {
    const newEntry: Entry = {
      ...change.node.row,
    };
    const {pos, found} = binarySearch(view, newEntry, schema.compareRows);
    assert(!found, 'node already exists');
    view.splice(pos, 0, newEntry);

    for (const [relationship, children] of Object.entries(
      change.node.relationships,
    )) {
      // TODO: Is there a flag to make TypeScript complain that dictionary access might be undefined?
      const childSchema = must(schema.relationships[relationship]);
      const newView: EntryList = [];
      newEntry[relationship] = newView;
      for (const node of children) {
        applyChange(newView, {type: 'add', node}, childSchema);
      }
    }
  } else if (change.type === 'remove') {
    const {pos, found} = binarySearch(
      view,
      change.node.row,
      schema.compareRows,
    );
    assert(found, 'node does not exist');
    view.splice(pos, 1);
  } else {
    change.type satisfies 'child';
    const {pos, found} = binarySearch(view, change.row, schema.compareRows);
    assert(found, 'node does not exist');

    const existing = view[pos];
    const childSchema = must(
      schema.relationships[change.child.relationshipName],
    );
    const existingList = existing[change.child.relationshipName];
    assert(Array.isArray(existingList));
    applyChange(existingList, change.child.change, childSchema);
  }
}

function binarySearch(view: EntryList, target: Entry, comparator: Comparator) {
  let low = 0;
  let high = view.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const comparison = comparator(view[mid] as Row, target as Row);
    if (comparison < 0) {
      low = mid + 1;
    } else if (comparison > 0) {
      high = mid - 1;
    } else {
      return {pos: mid, found: true};
    }
  }
  return {pos: low, found: false};
}