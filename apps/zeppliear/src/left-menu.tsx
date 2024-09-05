import classnames from 'classnames';
import {noop} from 'lodash';
import {RefObject, useRef, useState} from 'react';
import AboutModal from './about-modal.jsx';
import AddIcon from './assets/icons/add.svg?react';
import HelpIcon from './assets/icons/help.svg?react';
import MenuIcon from './assets/icons/menu.svg?react';
import {
  useIssueDetailState,
  useStatusFilterState,
} from './hooks/query-state-hooks.js';
import {useClickOutside} from './hooks/use-click-outside.js';
import useQueryState, {identityProcessor} from './hooks/useQueryState.js';
import IssueModal from './issue-modal.jsx';
import {Status, type IssueCreationPartial} from './issue.js';
import ItemGroup from './item-group.js';

interface Props {
  // Show menu (for small screen only)
  menuVisible: boolean;
  onCloseMenu?: () => void;
  onCreateIssue: (i: IssueCreationPartial) => void;
}

function LeftMenu({menuVisible, onCloseMenu = noop, onCreateIssue}: Props) {
  const [, setIss] = useIssueDetailState();

  const [disableAbout] = useQueryState('disableAbout', identityProcessor);

  const ref = useRef<HTMLDivElement>() as RefObject<HTMLDivElement>;
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);
  const [, setStatusFilter] = useStatusFilterState();

  const classes = classnames(
    'absolute lg:static inset-0 lg:relative lg:translate-x-0 flex flex-col flex-shrink-0 w-56 font-sans text-sm border-r lg:shadow-none justify-items-start bg-gray border-gray-850 text-white bg-opacity-1',
    {
      /* eslint-disable @typescript-eslint/naming-convention */
      '-translate-x-full shadow-none': !menuVisible,
      'translate-x-0 shadow-x z-50': menuVisible,
      /* eslint-enable @typescript-eslint/naming-convention */
    },
  );

  useClickOutside(ref, () => {
    if (menuVisible && onCloseMenu) {
      onCloseMenu();
    }
  });

  return (
    <>
      <div className={classes} ref={ref}>
        <button
          className="flex-shrink-0 px-5 ml-2 lg:hidden h-14 focus:outline-none"
          onMouseDown={onCloseMenu}
        >
          <MenuIcon className="w-3.5 text-gray-50 hover:text-gray-100" />
        </button>

        {/* actions */}
        <div className="flex flex-col flex-shrink flex-grow overflow-y-auto mb-0.5 px-4 py-3">
          <div
            className="flex items-center  px-3 py-2 mb-5 rounded cursor-pointer group h-8 hover:bg-gray-900"
            onMouseDown={() => {
              setIssueModalVisible(true);
              onCloseMenu && onCloseMenu();
            }}
          >
            <AddIcon className="mr-2.5 w-3.5 h-3.5" /> New Issue
          </div>

          <ItemGroup title="Views">
            <div
              className="flex items-center pl-9 rounded cursor-pointer group h-8 hover:bg-gray-900"
              onMouseDown={() => {
                setStatusFilter(null);
                setIss(null);
                onCloseMenu();
              }}
            >
              <span>All</span>
            </div>

            <div
              className="flex items-center pl-9 rounded cursor-pointer group h-8 hover:bg-gray-900"
              onMouseDown={() => {
                setStatusFilter(new Set([Status.InProgress, Status.Todo]));
                setIss(null);
                onCloseMenu();
              }}
            >
              <span>Active</span>
            </div>

            <div
              className="flex items-center pl-9 rounded cursor-pointer group h-8 hover:bg-gray-900"
              onMouseDown={async () => {
                await Promise.all([
                  setStatusFilter(new Set([Status.Backlog])),
                  setIss(null),
                ]);
                onCloseMenu && onCloseMenu();
              }}
            >
              <span>Backlog</span>
            </div>
          </ItemGroup>

          {/* extra space */}
          <div className="flex flex-col flex-grow flex-shrink" />

          {/* bottom group */}
          <div className="px-2 pb-2 text-gray-50 mt-7">
            <button
              className="inline-flex mt-1 focus:outline-none"
              onMouseDown={() => setAboutModalVisible(true)}
            >
              <HelpIcon className="w-3 mr-2 pt-1 h-4" /> About
            </button>
          </div>
        </div>
      </div>
      {/* Modals */}
      {
        <IssueModal
          isOpen={issueModalVisible}
          onDismiss={() => setIssueModalVisible(false)}
          onCreateIssue={onCreateIssue}
        />
      }
      {
        <AboutModal
          isOpen={aboutModalVisible && disableAbout !== 'true'}
          onDismiss={() => setAboutModalVisible(false)}
        />
      }
    </>
  );
}

export default LeftMenu;
