// Content of the .base file: a native Kanban view grouped by column, and a table of all cards.
// Pure module.

import type { PropertyNames } from './plan';
import { stringify } from './yaml';
import type { YamlMap } from './yaml';

export interface BaseOptions {
  boardName: string;
  props: PropertyNames;
  /** Column names, in board order. Every value must be listed: Bases hides cards whose value is missing. */
  columns: string[];
  columnWidth: number;
  boardView: string;
  tableView: string;
}

/** String literal for a Bases expression. */
export function expressionString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Reference to a note property inside a Bases expression. */
export function expressionProperty(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `note[${expressionString(name)}]`;
}

export function buildBase(options: BaseOptions): string {
  const { props } = options;
  const document: YamlMap = {
    filters: {
      and: [`${expressionProperty(props.board)} == ${expressionString(options.boardName)}`],
    },
    views: [
      {
        type: 'kanban',
        name: options.boardView,
        groupBy: { property: props.status, direction: 'ASC' },
        groupOrder: options.columns,
        columnWidth: options.columnWidth,
        order: ['file.name', props.due, props.tags],
        sort: [{ property: props.position, direction: 'ASC' }],
      },
      {
        type: 'table',
        name: options.tableView,
        order: ['file.name', props.status, props.due, props.done, props.tags],
        sort: [
          { property: props.status, direction: 'ASC' },
          { property: props.position, direction: 'ASC' },
        ],
      },
    ],
  };
  return stringify(document);
}
