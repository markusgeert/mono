import {generateNKeysBetween} from 'fractional-indexing';
import {findIndex, groupBy} from 'lodash';
import {memo, useCallback} from 'react';
import {DragDropContext, DropResult} from 'react-beautiful-dnd';

import {useQuery} from './hooks/use-zql.js';
import {
  Issue,
  IssueUpdate,
  IssueWithLabels,
  Priority,
  Status,
  orderQuery,
} from './issue';
import IssueCol from './issue-col';
import type {IssuesProps} from './issues-props.js';

export type IssuesByStatusType = {
  [Status.Backlog]: IssueWithLabels[];
  [Status.Todo]: IssueWithLabels[];
  [Status.InProgress]: IssueWithLabels[];
  [Status.Done]: IssueWithLabels[];
  [Status.Canceled]: IssueWithLabels[];
};

export const getIssueByType = (
  allIssues: IssueWithLabels[],
): IssuesByStatusType => {
  const issuesBySType = groupBy(allIssues, i => i.issue.status);
  const defaultIssueByType = {
    [Status.Backlog]: [],
    [Status.Todo]: [],
    [Status.InProgress]: [],
    [Status.Done]: [],
    [Status.Canceled]: [],
  };
  const result = {...defaultIssueByType, ...issuesBySType};
  return result;
};

export function getKanbanOrderIssueUpdates(
  issueToMove: Issue,
  issueToInsertBefore: Issue,
  issues: IssueWithLabels[],
): {issue: Issue; update: IssueUpdate}[] {
  const indexInKanbanOrder = findIndex(
    issues,
    i => i.issue.id === issueToInsertBefore.id,
  );
  let beforeKey: string | null = null;
  if (indexInKanbanOrder > 0) {
    beforeKey = issues[indexInKanbanOrder - 1].issue.kanbanOrder;
  }
  let afterKey: string | null = null;
  const issuesToReKey: Issue[] = [];
  // If the issues we are trying to move between
  // have identical kanbanOrder values, we need to fix up the
  // collision by re-keying the issues.
  for (let i = indexInKanbanOrder; i < issues.length; i++) {
    if (issues[i].issue.kanbanOrder !== beforeKey) {
      afterKey = issues[i].issue.kanbanOrder;
      break;
    }
    issuesToReKey.push(issues[i].issue);
  }
  const newKanbanOrderKeys = generateNKeysBetween(
    beforeKey,
    afterKey,
    issuesToReKey.length + 1, // +1 for the dragged issue
  );

  const issueUpdates = [
    {
      issue: issueToMove,
      update: {id: issueToMove.id, kanbanOrder: newKanbanOrderKeys[0]},
    },
  ];
  for (let i = 0; i < issuesToReKey.length; i++) {
    issueUpdates.push({
      issue: issuesToReKey[i],
      update: {id: issuesToReKey[i].id, kanbanOrder: newKanbanOrderKeys[i + 1]},
    });
  }
  return issueUpdates;
}

interface Props {
  issuesProps: IssuesProps;
  onUpdateIssues: (issueUpdates: {issue: Issue; update: IssueUpdate}[]) => void;
  onOpenDetail: (issue: Issue) => void;
}

function IssueBoard({issuesProps, onUpdateIssues, onOpenDetail}: Props) {
  const {query, order, queryDeps} = issuesProps;
  const issueQueryOrdered = orderQuery(query, order, false);
  const issues = useQuery(issueQueryOrdered, queryDeps);

  // TODO(arv): Use ZQL group by
  const issuesByType = getIssueByType(issues);

  const handleDragEnd = useCallback(
    ({source, destination}: DropResult) => {
      if (!destination) {
        return;
      }
      const sourceStatus = parseInt(source.droppableId) as Status;
      const draggedIssue = issuesByType[sourceStatus][source.index]?.issue;
      if (!draggedIssue) {
        return;
      }
      const newStatus = parseInt(destination.droppableId) as Status;
      const newIndex =
        sourceStatus === newStatus && source.index < destination.index
          ? destination.index + 1
          : destination.index;
      const issueToInsertBefore = issuesByType[newStatus][newIndex]?.issue;
      if (draggedIssue === issueToInsertBefore) {
        return;
      }
      const issueUpdates = issueToInsertBefore
        ? getKanbanOrderIssueUpdates(draggedIssue, issueToInsertBefore, issues)
        : [{issue: draggedIssue, update: {id: draggedIssue.id}}];
      if (newStatus !== sourceStatus) {
        issueUpdates[0] = {
          ...issueUpdates[0],
          update: {
            ...issueUpdates[0].update,
            status: newStatus,
          },
        };
      }
      onUpdateIssues(issueUpdates);
    },
    [issues, issuesByType, onUpdateIssues],
  );

  const handleChangePriority = useCallback(
    (issue: Issue, priority: Priority) => {
      onUpdateIssues([
        {
          issue,
          update: {id: issue.id, priority},
        },
      ]);
    },
    [onUpdateIssues],
  );

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex flex-1 pt-6 pl-8 overflow-scroll-x bg-gray border-color-gray-50 border-right-width-1">
        <IssueCol
          title={'Backlog'}
          status={Status.Backlog}
          issuesProps={issuesProps}
          onChangePriority={handleChangePriority}
          onOpenDetail={onOpenDetail}
        />
        <IssueCol
          title={'Todo'}
          status={Status.Todo}
          issuesProps={issuesProps}
          onChangePriority={handleChangePriority}
          onOpenDetail={onOpenDetail}
        />
        <IssueCol
          title={'In Progress'}
          status={Status.InProgress}
          issuesProps={issuesProps}
          onChangePriority={handleChangePriority}
          onOpenDetail={onOpenDetail}
        />
        <IssueCol
          title={'Done'}
          status={Status.Done}
          issuesProps={issuesProps}
          onChangePriority={handleChangePriority}
          onOpenDetail={onOpenDetail}
        />
        <IssueCol
          title={'Canceled'}
          status={Status.Canceled}
          issuesProps={issuesProps}
          onChangePriority={handleChangePriority}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </DragDropContext>
  );
}

export default memo(IssueBoard);
