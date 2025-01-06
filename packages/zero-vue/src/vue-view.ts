import {reactive} from 'vue';
import {
  applyChange,
  type Change,
  type Entry,
  type Format,
  type Input,
  type Output,
  type Query,
  type QueryType,
  type Smash,
  type TableSchema,
  type View,
} from '../../zero-advanced/src/mod.js';
import type {QueryResultDetails} from './use-query.js';

export class VueView<V extends View> implements Output {
  readonly #input: Input;
  readonly #format: Format;
  readonly #onDestroy: () => void;

  // Synthetic "root" entry that has a single "" relationship, so that we can
  // treat all changes, including the root change, generically.
  readonly #root: Entry;

  readonly #details: QueryResultDetails;

  constructor(
    input: Input,
    format: Format = {singular: false, relationships: {}},
    onDestroy: () => void = () => {},
    queryComplete: true | Promise<true>,
  ) {
    this.#input = input;
    this.#format = format;
    this.#onDestroy = onDestroy;
    this.#root = reactive({
      '': format.singular ? undefined : [],
    });
    input.setOutput(this);

    this.#details = reactive({type: 'unknown'});

    if (queryComplete === true) {
      this.#details.type = 'complete';
    } else {
      void queryComplete.then(() => {
        this.#details.type = 'complete';
      });
    }

    for (const node of input.fetch({})) {
      applyChange(
        this.#root,
        {type: 'add', node},
        input.getSchema(),
        '',
        this.#format,
      );
    }
  }

  get data() {
    return this.#root[''] as V;
  }

  get details() {
    return this.#details;
  }

  destroy() {
    this.#onDestroy();
  }

  push(change: Change): void {
    applyChange(this.#root, change, this.#input.getSchema(), '', this.#format);
  }
}

export function vueViewFactory<
  TSchema extends TableSchema,
  TReturn extends QueryType,
>(
  _query: Query<TSchema, TReturn>,
  input: Input,
  format: Format,
  onDestroy: () => void,
  _: (cb: () => void) => void,
  queryComplete: true | Promise<true>,
): VueView<Smash<TReturn>> {
  const v = new VueView<Smash<TReturn>>(
    input,
    format,
    onDestroy,
    queryComplete,
  );

  return v;
}