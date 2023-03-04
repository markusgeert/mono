import {nanoid} from 'nanoid';
import {initialize} from './data';
import {renderer as renderer3D} from './3d-renderer';
import {render} from './texture-renderer';
import initRenderer, {
  draw_caches,
  precompute,
  get_physics_cache_step,
} from '../../vendor/renderer';
import {get3DPositions} from '../shared/renderer';
import {cursorRenderer} from './cursors';
import {
  UVMAP_SIZE,
  FPS_LOW_PASS,
  COLOR_PALATE,
  COLOR_PALATE_END,
  STEP_RENDER_DELAY,
  DEBUG_PHYSICS,
  SPLATTER_MS,
  STEP_UPDATE_INTERVAL,
  MIN_STEP_MS,
  DEBUG_TEXTURES,
} from '../shared/constants';
import type {Actor, ColorPalate, Letter, Position} from '../shared/types';
import {LETTERS} from '../shared/letters';
import {letterMap, now} from '../shared/util';
import {initRoom} from './init-room';
import {getUserLocation} from './location';

type LetterCanvases = Record<Letter, HTMLCanvasElement>;

type Debug = {
  fps: number;
};

export const init = async () => {
  const initTiming = timing('Demo Load Timing');
  const ready = initTiming('loading demo', 1500);
  // Generate an actor ID, which is just used for "auth" (which we don't really have)
  const actorId = localStorage.getItem('paint-fight-actor-id') || nanoid();
  localStorage.setItem('paint-fight-actor-id', actorId);

  const debug: Debug = {fps: 60};
  type DebugCanvases = [
    CanvasRenderingContext2D,
    CanvasRenderingContext2D,
    CanvasRenderingContext2D,
    CanvasRenderingContext2D,
    CanvasRenderingContext2D,
  ];

  // Canvases
  const canvas = document.getElementById('canvas3D') as HTMLCanvasElement;
  const textures: LetterCanvases = letterMap(letter => {
    const tex = document.querySelector(
      `#textures > .${letter}`,
    ) as HTMLCanvasElement;
    tex.width = UVMAP_SIZE;
    tex.height = UVMAP_SIZE;
    return tex;
  });
  const buffers: LetterCanvases = letterMap(letter => {
    const tex = document.querySelector(
      `#buffers > .${letter}`,
    ) as HTMLCanvasElement;
    tex.width = UVMAP_SIZE;
    tex.height = UVMAP_SIZE;
    return tex;
  });
  let caches: DebugCanvases;
  if (DEBUG_TEXTURES) {
    caches = LETTERS.map(letter => {
      const tex = document.querySelector(
        `#caches > .${letter}`,
      ) as HTMLCanvasElement;
      tex.width = UVMAP_SIZE;
      tex.height = UVMAP_SIZE;
      return tex.getContext('2d') as CanvasRenderingContext2D;
    }) as DebugCanvases;
  }
  const demoContainer = document.getElementById('demo') as HTMLDivElement;

  // Set up 3D renderer
  const init3dDone = initTiming('setting up 3D engine', 1000);
  const {
    render: render3D,
    getTexturePosition,
    resizeCanvas: resize3DCanvas,
    set3DPosition,
    updateTexture,
    updateCurrentStep,
    // updateDebug,
  } = await renderer3D(canvas, textures);
  init3dDone();

  const roomInitDone = initTiming('initializing room', 100);
  const roomID = await initRoom();
  roomInitDone();

  // Set up info below demo
  const activeUserCount = document.getElementById(
    'active-user-count',
  ) as HTMLDivElement;
  const roomHref = `${window.location.href}#${roomID}`;
  const copyRoomButton = document.getElementById('copy-room-button');
  copyRoomButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomHref);
      copyRoomButton.classList.add('copied');
    } catch (e) {
      alert('Copying link failed.');
    }
    setTimeout(() => {
      copyRoomButton.classList.remove('copied');
    }, 1000);
  });
  const newRoomButton = document.getElementById('new-room-button');
  newRoomButton?.addEventListener('click', () => {
    localStorage.removeItem('roomID');
    window.location.reload();
  });

  const initRendererDone = initTiming('initializing renderer module', 100);
  await initRenderer();
  await precompute();
  initRendererDone();

  const initReflectClientDone = initTiming('initializing reflect client', 20);
  const {
    getState,
    sendStep,
    updateCursor,
    addSplatter,
    addListener,
    updateActorLocation,
  } = await initialize(roomID, actorId);
  initReflectClientDone();

  // Get our location and add it when it's ready
  getUserLocation().then(location => {
    updateActorLocation({actorId, location});
  });

  // Initialize state
  let {
    step,
    actors,
    physicsStep,
    cursors,
    rawCaches,
    splatters,
    sequences,
    impulses,
  } = await getState();
  let localStep = step;

  // Whenever actors change, update the count
  addListener<Actor>('actor', () => {
    activeUserCount.innerHTML = Object.keys(actors).length + '';
  });

  // Initialize textures
  LETTERS.forEach(letter => updateTexture(letter));

  const colors: ColorPalate = [
    [COLOR_PALATE[0], COLOR_PALATE_END[0]],
    [COLOR_PALATE[1], COLOR_PALATE_END[1]],
    [COLOR_PALATE[2], COLOR_PALATE_END[2]],
    [COLOR_PALATE[3], COLOR_PALATE_END[3]],
    [COLOR_PALATE[4], COLOR_PALATE_END[4]],
  ];

  // Update debug info periodically
  if (window.location.search.includes('debug')) {
    setInterval(async () => {
      const debugEl = document.getElementById('debug');
      const splatterCount = Object.keys(splatters).reduce(
        (acc, k) => splatters[k as Letter].length + acc,
        0,
      );
      const impulseCount = Object.keys(impulses).reduce(
        (acc, k) => impulses[k as Letter].length + acc,
        0,
      );
      if (debugEl) {
        let physicsCacheStep = get_physics_cache_step();
        const drift = localStep - step;
        let debugOutput = `${
          Object.keys(actors).length
        } actors\n${splatterCount} splatters\n${impulseCount} impulses\n${debug.fps.toFixed(
          1,
        )} fps\n${LETTERS.map(letter => {
          return `${letter.toUpperCase()} [seq ${
            sequences[letter]
          }]\n   splatters: ${splatters[letter].length}\n   impulses: ${
            impulses[letter].length
          }\n  cache size:\n    ${
            new Blob([rawCaches[letter] || '']).size / 1024
          }k\n`;
        }).join('\n')}\n\nlocal step: ${Math.floor(
          localStep,
        )}\nserver step:${Math.floor(step)}\nstep drift: ${
          drift > 0 ? '+' : '-'
        }${drift.toFixed(
          1,
        )}\n\nserver physics step: ${physicsStep}\ncached physics step: ${physicsCacheStep}\nphysics window size: ${
          localStep - physicsCacheStep
        }`;
        debugEl.innerHTML = debugOutput;
      }
      if (caches) {
        draw_caches(...caches);
      }
    }, 200);
  }

  // Set up cursor renderer
  const [localCursor, renderCursors] = cursorRenderer(
    actorId,
    () => ({actors, cursors}),
    () => demoContainer,
    updateCursor,
  );

  // When the window is resized, recalculate letter and cursor positions
  const resizeViewport = () => {
    const {width, height} = demoContainer.getBoundingClientRect();
    canvas.height = height * window.devicePixelRatio;
    canvas.width = width * window.devicePixelRatio;
    canvas.style.height = height + 'px';
    canvas.style.width = width + 'px';
    resize3DCanvas();
    renderCursors();
  };
  window.addEventListener('resize', resizeViewport);
  resizeViewport();

  // Step management
  const updateStep = () => {
    // Don't increment our step more than once per MIN_STEP_MS, which is about 60 times per second.
    // If we render too quickly or too slowly, adjust our steps so that it will
    // converge on the target step.
    if (localStep < step) {
      // If we're behind, catch up half the distance
      localStep += step - localStep;
    } else if (localStep > step) {
      // If we're ahead of the server, render at .5 speed
      localStep += 0.5;
    } else {
      localStep += 1;
    }
  };

  // Set up physics rendering
  let lastRenderedPhysicsStep = physicsStep;
  const renderPhysics = () => {
    updateCurrentStep(localStep);
    const targetStep = Math.max(Math.floor(localStep) - STEP_RENDER_DELAY, 0);
    if (targetStep === lastRenderedPhysicsStep) {
      // Skip no-ops
      return;
    }
    // positions3d
    const positions3d = get3DPositions(targetStep, impulses);
    lastRenderedPhysicsStep = targetStep;
    if (positions3d) {
      LETTERS.forEach(letter => {
        const position3d = positions3d[letter];
        if (position3d) {
          set3DPosition(letter, position3d);
        }
      });
    }
    if (DEBUG_PHYSICS) {
      // TODO: fix this
      // let world = World.restoreSnapshot(debugState);
      // updateDebug(world.debugRender());
    }
  };

  const addPaint = (at: Position) => {
    const [letter, texturePosition, hitPosition] = getTexturePosition(at);
    if (letter && texturePosition && hitPosition) {
      addSplatter({
        letter,
        actorId,
        colorIndex: actors[actorId].colorIndex,
        texturePosition,
        hitPosition,
        sequence: sequences[letter],
        step: Math.round(localStep),
      });
    }
  };

  // Render our cursors and canvases at "animation speed", usually 60fps
  let lastSplatter = 0;
  let sentStepLast = now();
  startRenderLoop(
    async () => {
      ({
        actors,
        step,
        physicsStep,
        cursors,
        rawCaches,
        splatters,
        sequences,
        impulses,
      } = await getState());
      // Increment our step
      updateStep();
      // Render our textures
      render(localStep, buffers, textures, splatters, colors);
      // Update textures and render the 3D scene
      LETTERS.forEach(letter => updateTexture(letter));
      renderPhysics();
      render3D();
      // Splatter if needed
      const {isDown, position} = localCursor();
      if (isDown && now() > lastSplatter + SPLATTER_MS) {
        lastSplatter = now();
        addPaint(position);
      } else if (!isDown) {
        lastSplatter = 0;
      }
      if (now() > sentStepLast + STEP_UPDATE_INTERVAL) {
        sentStepLast = now();
        sendStep(localStep);
      }
    },
    async () => {
      // Our cursors should update every animation frame.
      await renderCursors();
    },
    debug,
  );

  // After we've started, flip a class on the body
  document.body.classList.add('demo-active');
  ready(true);
};

const startRenderLoop = (
  render: () => Promise<void>,
  renderUngated: () => Promise<void>,
  debug: Debug,
) => {
  // Render loop - run render on every frame
  let frameTime = 0;
  let lastLoop = performance.now();
  let thisLoop = performance.now();
  const _redraw = async () => {
    // Call the renderUngated method on all animation frames (sometimes up to 120fps
    // in some browsers/gpus)
    await renderUngated();
    // Call the render method at ~60fps
    if (performance.now() - lastLoop >= MIN_STEP_MS) {
      await render();
      thisLoop = performance.now();
    }
    // Track a low-pass filtered fps
    let thisFrameTime = thisLoop - lastLoop;
    frameTime += (thisFrameTime - frameTime) / FPS_LOW_PASS;
    lastLoop = thisLoop;
    debug.fps = 1000 / frameTime;
    requestAnimationFrame(_redraw);
  };
  _redraw();
};

export const timing = (name: string) => {
  const emit = (message: string, duration: number, color?: string) => {
    if (duration === -1) {
      return console.log(`%cStart ${message}`, 'color: #9bb3af');
    }
    console.log(
      `%cFinished ${message} in %c${duration.toFixed(0)}ms`,
      'color: #9bb3af',
      `color: ${color}`,
    );
  };
  let inGroup = false;
  return (message: string, good: number) => {
    const taskStart = performance.now();
    if (!inGroup) {
      console.group(name);
      inGroup = true;
    }
    emit(message, -1);
    return (done?: true) => {
      const time = performance.now() - taskStart;
      const color =
        time <= good ? '#00d0aa' : time < good * 2 ? '#f0e498' : '#ff6d91';
      emit(message, time, color);
      if (done) {
        console.groupEnd();
        inGroup = false;
      }
    };
  };
};
