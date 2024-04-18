import type {
  AST,
  Condition,
  Conjunction,
  Primitive,
  SimpleCondition,
  SimpleOperator,
} from '@rocicorp/zql/src/zql/ast/ast.js';
import {describe, expect, test} from 'vitest';
import {
  NormalizedInvalidationFilterSpec,
  invalidationHash,
} from '../types/invalidation.js';
import {computeInvalidationInfo, computeMatchers} from './invalidation.js';
import {getNormalized} from './normalize.js';

describe('zql/invalidation matchers', () => {
  type Case = {
    name: string;
    cond: Condition | undefined;
    matches: Record<string, Primitive>[];
  };

  const cases: Case[] = [
    {
      name: 'no WHERE clause',
      cond: undefined,
      matches: [{}],
    },
    {
      name: 'inequality',
      cond: cond('foo', '>', 3),
      matches: [{}],
    },
    {
      name: 'AND inequalities',
      cond: and(cond('foo', '>', 3), cond('foo', '!=', 10)),
      matches: [{}],
    },
    {
      name: 'OR inequalities',
      cond: or(cond('foo', '>', 3), cond('foo', '!=', 10)),
      matches: [{}],
    },
    {
      name: 'equality',
      cond: cond('foo', '=', 3),
      matches: [{foo: 3}],
    },
    {
      name: 'AND equality',
      cond: and(
        cond('foo', '=', 3),
        cond('bar', '=', 'baz'),
        cond('boo', '=', 'bonk'),
      ),
      matches: [{bar: 'baz', boo: 'bonk', foo: 3}],
    },
    {
      name: 'AND equality, never match',
      cond: and(
        cond('foo', '=', 3),
        cond('bar', '=', 'baz'),
        cond('foo', '=', 10),
      ),
      matches: [],
    },
    {
      name: 'OR equality',
      cond: or(
        cond('foo', '=', 3),
        cond('bar', '=', 'baz'),
        cond('boo', '=', 'bonk'),
      ),
      matches: [{bar: 'baz'}, {boo: 'bonk'}, {foo: 3}],
    },
    {
      name: 'AND: mixed equality and inequality',
      cond: and(
        cond('foo', '=', 3),
        cond('bar', '>', 4),
        cond('boo', '=', 'bonk'),
      ),
      matches: [{boo: 'bonk', foo: 3}],
    },
    {
      name: 'OR: mixed equality and inequality',
      cond: or(
        cond('foo', '=', 3),
        cond('bar', '>', 4),
        cond('boo', '=', 'bonk'),
      ),
      matches: [{}],
    },
    {
      name: 'Nesting: OR of ANDs with subsumption',
      cond: or(
        cond('foo', '=', 1),
        and(cond('foo', '=', 3), cond('boo', '=', 'bonk')),
        and(cond('foo', '=', 4), cond('boo', '=', 'bar')),
        and(
          cond('foo', '=', 4),
          cond('boo', '=', 'bar'),
          cond('should-be', '=', 'subsumed'),
        ),
        and(
          cond('foo', '=', 2),
          cond('boo', '=', 'bar'),
          cond('not', '=', 'subsumed'),
        ),
      ),
      matches: [
        {foo: 1},
        {boo: 'bonk', foo: 3},
        {boo: 'bar', foo: 4},
        {boo: 'bar', foo: 2, not: 'subsumed'},
      ],
    },
    {
      name: 'Nesting: AND of ORs',
      cond: and(
        cond('do', '=', 1),
        or(cond('foo', '=', 3), cond('boo', '=', 'bonk')),
        or(
          cond('food', '=', 2),
          cond('bood', '=', 'bar'),
          cond('bonk', '=', 'boom'),
        ),
      ),
      matches: [
        {do: 1, foo: 3, food: 2},
        {do: 1, foo: 3, bood: 'bar'},
        {do: 1, foo: 3, bonk: 'boom'},
        {do: 1, boo: 'bonk', food: 2},
        {do: 1, boo: 'bonk', bood: 'bar'},
        {do: 1, boo: 'bonk', bonk: 'boom'},
      ],
    },
    {
      name: 'Nesting: AND of ORs with never removal',
      cond: and(
        or(cond('foo', '=', 3), cond('boo', '=', 'bonk')),
        or(cond('foo', '=', 4), cond('boo', '=', 'bar')),
      ),
      matches: [
        {foo: 3, boo: 'bar'},
        {foo: 4, boo: 'bonk'},
      ],
    },
    {
      name: 'Nesting: AND of ORs with never removal and subsumption',
      cond: and(
        or(cond('foo', '=', 3), cond('boo', '=', 'bonk')),
        or(cond('foo', '=', 4), cond('boo', '=', 'bar')),
        or(
          cond('foo', '=', 2),
          cond('boo', '=', 'bar'),
          cond('sometimes', '=', 'subsumed'),
        ),
      ),
      matches: [
        {foo: 3, boo: 'bar'},
        // Subsumed by previous match: {foo: 3, boo: 'bar', sometimes: 'subsumed'},
        {foo: 4, boo: 'bonk', sometimes: 'subsumed'},
      ],
    },
    {
      name: 'Max depth successful', // MAX_DEPTH is set to 3 for the test.
      cond: and(
        cond('foo', '=', 1),
        or(
          cond('bar', '=', 3),
          and(cond('boo', '=', 'bonk'), cond('do', '=', 4)),
        ),
      ),
      matches: [
        {foo: 1, bar: 3},
        {foo: 1, boo: 'bonk', do: 4},
      ],
    },
    {
      name: 'Max depth exceeded', // MAX_DEPTH is set to 3 for the test.
      cond: and(
        cond('foo', '=', 1),
        or(
          cond('bar', '=', 3),
          and(
            cond('boo', '=', 'bonk'),
            // This OR is not traversed and represented by "match anything".
            or(cond('bar', '=', 'baz'), cond('do', '=', 4)),
          ),
        ),
      ),
      matches: [
        {foo: 1, bar: 3},
        {foo: 1, boo: 'bonk'},
      ],
    },
  ];

  const MAX_DEPTH = 3;

  for (const c of cases) {
    test(c.name, () => {
      const matches = computeMatchers(c.cond, MAX_DEPTH).map(m => m.getMatch());
      expect(new Set(matches)).toEqual(new Set(c.matches));
    });
  }
});

describe('zql/invalidation hashes filters and hashes', () => {
  type Case = {
    name: string;
    ast: AST;
    filters: NormalizedInvalidationFilterSpec[];
    hashes: string[];
  };

  const FULL_TABLE_INVALIDATION = invalidationHash({
    schema: 'public',
    table: 'foo',
    allRows: true,
  });

  const cases: Case[] = [
    {
      name: 'no WHERE',
      ast: {table: 'foo', select: [['id', 'id']], orderBy: [['id'], 'asc']},
      filters: [
        {
          id: '1scpn2ec370qk',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
        }),
      ],
    },
    {
      name: 'aggregation with column',
      ast: {
        table: 'foo',
        aggregate: [{aggregate: 'min', field: 'priority', alias: 'ignored'}],
        orderBy: [['ignored'], 'asc'],
      },
      filters: [
        {
          id: 'jx5gcczzxpcz',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['priority'],
          filteredColumns: {},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['priority'],
        }),
      ],
    },
    {
      name: 'aggregation without column',
      ast: {
        table: 'foo',
        aggregate: [{aggregate: 'count', alias: 'ignored'}],
        orderBy: [['ignored'], 'asc'],
      },
      filters: [
        {
          id: '36jnh0mt9ui1w',
          schema: 'public',
          table: 'foo',
          filteredColumns: {},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
        }),
      ],
    },
    {
      name: 'AND filter',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: and(
          cond('foo', '=', 'bar'),
          cond('bar', '=', 2),
          cond('a', '<', 3), // Ignored
        ),
      },
      filters: [
        {
          id: '3aqv7m9tgnnqr',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '=', bar: '='},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {bar: '2', foo: '"bar"'},
        }),
      ],
    },
    {
      name: 'OR filter',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: or(
          cond('foo', '=', 'bar'),
          cond('bar', '=', 2),
          and(cond('foo', '=', 'boo'), cond('bar', '=', 3)),
        ),
      },
      filters: [
        {
          id: 's10pisblnaw5',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '='},
        },
        {
          id: 'blpzmgykw6hk',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {bar: '='},
        },
        {
          id: '3aqv7m9tgnnqr',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '=', bar: '='},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {bar: '2'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '"bar"'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {bar: '3', foo: '"boo"'},
        }),
      ],
    },
    {
      name: 'OR filter (subsumption)',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: or(
          cond('foo', '=', 'bar'),
          cond('bar', '=', 2),
          and(cond('foo', '=', 'bar'), cond('bar', '=', 3)),
        ),
      },
      filters: [
        {
          id: 's10pisblnaw5',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '='},
        },
        {
          id: 'blpzmgykw6hk',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {bar: '='},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {bar: '2'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '"bar"'},
        }),
      ],
    },
    {
      name: 'OR filter on the same field (multiple tags for a filter)',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: or(
          cond('foo', '=', 'bar'),
          cond('foo', '=', 'baz'),
          cond('foo', '=', 'boo'),
        ),
      },
      filters: [
        {
          id: 's10pisblnaw5',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '='},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '"bar"'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '"baz"'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {foo: '"boo"'},
        }),
      ],
    },
    {
      name: 'AND with nested ORs (full outer product)',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: and(
          or(cond('a', '=', 1), cond('b', '=', 2)),
          or(cond('c', '=', 3), cond('d', '=', 4)),
          or(cond('e', '=', 5), cond('f', '=', 6)),
        ),
      },
      filters: [
        {
          id: '2t1fufx1makbn',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '=', c: '=', e: '='},
        },
        {
          id: '2br2e2gteqg2u',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '=', d: '=', e: '='},
        },
        {
          id: '19qclbkdx7o4b',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '=', c: '=', f: '='},
        },
        {
          id: '38l330qvpozvv',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '=', d: '=', f: '='},
        },
        {
          id: 'im36hl0oh86g',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '=', c: '=', e: '='},
        },
        {
          id: '1ypj3fl6fjjjh',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '=', d: '=', e: '='},
        },
        {
          id: 'lw9gqwn29foc',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '=', c: '=', f: '='},
        },
        {
          id: '3flty9g04yhjn',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '=', d: '=', f: '='},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '1', c: '3', e: '5'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '1', d: '4', e: '5'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '1', c: '3', f: '6'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {a: '1', d: '4', f: '6'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '2', c: '3', e: '5'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '2', d: '4', e: '5'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '2', c: '3', f: '6'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {b: '2', d: '4', f: '6'},
        }),
      ],
    },
    {
      name: 'AND with nested ORs (impossibilities pruned)',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: and(
          or(cond('foo', '=', 'bar'), cond('bar', '=', 1)),
          or(cond('bar', '=', 2), cond('do', '=', 'foo')),
          or(cond('foo', '=', 'boo'), cond('do', '=', 'boo')),
        ),
      },
      filters: [
        {
          id: '3mozdzxkk72v',
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {do: '=', bar: '=', foo: '='},
        },
      ],
      hashes: [
        FULL_TABLE_INVALIDATION,
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {do: '"boo"', bar: '2', foo: '"bar"'},
        }),
        invalidationHash({
          schema: 'public',
          table: 'foo',
          selectedColumns: ['id'],
          filteredColumns: {do: '"foo"', bar: '1', foo: '"boo"'},
        }),
      ],
    },
    {
      name: 'impossibility',
      ast: {
        table: 'foo',
        select: [['id', 'id']],
        orderBy: [['id'], 'asc'],
        where: and(
          cond('foo', '=', 'bar'),
          cond('bar', '=', 2),
          or(cond('foo', '=', 'boo'), cond('bar', '=', 3)),
        ),
      },
      filters: [],
      hashes: [],
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const inv = computeInvalidationInfo(getNormalized(c.ast));
      expect(new Set(inv.filters)).toEqual(new Set(c.filters));
      expect(new Set(inv.hashes)).toEqual(new Set(c.hashes));
    });
  }
});

// Readability helpers

function and(...conditions: Condition[]): Conjunction {
  return {
    type: 'conjunction',
    op: 'AND',
    conditions,
  };
}

function or(...conditions: Condition[]): Conjunction {
  return {
    type: 'conjunction',
    op: 'OR',
    conditions,
  };
}

function cond(
  field: string,
  op: SimpleOperator,
  value: Primitive,
): SimpleCondition {
  return {
    type: 'simple',
    field,
    op,
    value: {
      type: 'literal',
      value,
    },
  };
}