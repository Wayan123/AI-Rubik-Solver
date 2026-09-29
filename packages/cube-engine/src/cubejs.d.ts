declare module "cubejs" {
  interface CubeInstance {
    move(moves: string): CubeInstance;
    asString(): string;
    isSolved(): boolean;
    solve(maxDepth?: number): string;
  }
  interface CubeStatic {
    new (): CubeInstance;
    fromString(str: string): CubeInstance;
    initSolver(): void;
    random(): CubeInstance;
  }
  const Cube: CubeStatic;
  export default Cube;
}
