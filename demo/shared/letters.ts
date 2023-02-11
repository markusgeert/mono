import {BoundingBox, Letter, Size} from './types';

export const LETTERS = [Letter.A, Letter.L, Letter.I, Letter.V, Letter.E];

export const LETTER_POSITIONS_BASE_SCALE: Size = {
  width: 320,
  height: 113,
};

// Positions @ 320x113 resolution
export const LETTER_POSITIONS: Record<Letter, BoundingBox> = {
  [Letter.A]: {
    x: 0.328,
    y: 32.263,
    width: 69.856,
    height: 80.512,
  },
  [Letter.L]: {
    x: 83.237,
    y: 4.44,
    width: 25.1597,
    height: 106.56,
  },
  [Letter.I]: {
    x: 120.935,
    y: 0,
    width: 29.304,
    height: 111,
  },
  [Letter.V]: {
    x: 154.488,
    y: 34.04,
    width: 85.84,
    height: 76.96,
  },
  [Letter.E]: {
    x: 242.216,
    y: 32.264,
    width: 77.108,
    height: 80.512,
  },
};

// @ 320x113 resolution
export const LETTER_PATHS: Record<Letter, string> = {
  [Letter.A]:
    'M23.98,80.51c-6.91,0-12.63-1.97-17.17-5.92-4.54-4.05-6.81-9.77-6.81-17.17,0-6.81,2.32-12.19,6.96-16.13,4.74-4.05,11.15-6.41,19.24-7.1l17.91-1.57v-3.9c0-2.86-.84-5.08-2.52-6.66-1.68-1.68-3.8-2.52-6.36-2.52-2.86,0-5.13,.79-6.81,2.37-1.58,1.48-2.47,3.5-2.66,6.07H1.63c.2-5.33,1.68-10.11,4.44-14.36,2.76-4.24,6.61-7.55,11.54-9.92C22.64,1.23,28.61,0,35.52,0c10.75,0,18.99,2.71,24.72,8.14,5.82,5.43,8.73,12.93,8.73,22.5v30.34l.89,17.76h-23.38l-.59-9.92h-1.18c-2.07,3.95-4.88,6.91-8.44,8.88-3.55,1.88-7.65,2.81-12.28,2.81Zm9.62-33.3c-3.35,.39-5.77,1.28-7.25,2.66-1.48,1.28-2.22,2.96-2.22,5.03s.64,3.85,1.92,5.33c1.38,1.38,3.35,2.07,5.92,2.07s4.88-.54,6.66-1.63c1.87-1.18,3.26-2.81,4.14-4.88,.89-2.17,1.33-4.79,1.33-7.84v-1.99l-10.51,1.25Z',
  [Letter.L]: 'M0,106.56V0H25.16V106.56H0Z',
  [Letter.I]:
    'M2.07,111V34.04H27.23V111H2.07ZM0,13.91C0,9.97,1.28,6.66,3.85,4,6.51,1.33,10.11,0,14.65,0s8.09,1.33,10.66,4c2.66,2.66,4,5.97,4,9.92s-1.33,7.01-4,9.77c-2.57,2.76-6.12,4.14-10.66,4.14s-8.14-1.38-10.8-4.14C1.28,20.92,0,17.66,0,13.91Z',
  [Letter.V]:
    'M28.86,76.96L0,0H28.56l13.62,46.03h1.48L58.16,0h27.68l-28.86,76.96H28.86Z',
  [Letter.E]:
    'M39.81,80.51c-7.8,0-14.7-1.58-20.72-4.74-6.02-3.26-10.71-7.89-14.06-13.91C1.68,55.85,0,48.64,0,40.26c0-7.1,1.58-13.71,4.74-19.83,3.26-6.12,7.79-11.05,13.62-14.8C24.27,1.87,31.23,0,39.22,0s15.1,1.78,20.72,5.33c5.62,3.45,9.87,8.34,12.73,14.65,2.96,6.31,4.44,13.71,4.44,22.2v4.14H25.55c.29,2.08,.76,3.9,1.39,5.48,1.28,2.86,3.01,4.98,5.18,6.36,2.17,1.38,4.74,2.07,7.7,2.07s5.23-.64,7.1-1.92c1.97-1.38,3.6-3.06,4.88-5.03l22.5,8.14c-2.57,5.72-6.56,10.36-11.99,13.91-5.43,3.45-12.93,5.18-22.5,5.18Zm10.51-52.39c-.79-2.57-2.12-4.54-4-5.92-1.78-1.48-4.14-2.22-7.1-2.22s-5.67,.74-7.84,2.22c-2.07,1.38-3.65,3.6-4.74,6.66-.4,1.2-.72,2.53-.95,4h25.72c-.22-1.69-.58-3.27-1.09-4.74Z',
};
