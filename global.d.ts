/// <reference types="nativewind/types" />

declare module '*.css';

// SVG files import as React components via react-native-svg-transformer.
declare module '*.svg' {
  import type React from 'react';
  import type { SvgProps } from 'react-native-svg';
  const content: React.FC<SvgProps>;
  export default content;
}
