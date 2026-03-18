import React, { useState, useEffect, useCallback } from 'react';
import { Flag, Bomb, Smile, Frown, Meh, RefreshCw, Clock, Trophy } from 'lucide-react';
import { motion } from 'motion/react';

class SoundEngine {
  ctx: AudioContext | null = null;

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq: number, type: OscillatorType, duration: number, vol: number = 0.1) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.error(e);
    }
  }

  playClick() { this.playTone(400, 'sine', 0.1, 0.05); }
  playFlag() { this.playTone(800, 'square', 0.1, 0.02); }
  playUnflag() { this.playTone(300, 'square', 0.1, 0.02); }
  playChord() { 
    this.playTone(500, 'sine', 0.05, 0.05); 
    setTimeout(() => this.playTone(700, 'sine', 0.05, 0.05), 50);
  }
  
  playExplosion() {
    if (!this.ctx) return;
    try {
      const bufferSize = this.ctx.sampleRate * 1.5; 
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 1.5);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.5);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      noise.start();
    } catch (e) {
      console.error(e);
    }
  }

  playWin() {
    if (!this.ctx) return;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 'sine', 0.3, 0.1), i * 100);
    });
  }
}

const sound = new SoundEngine();

type Difficulty = 'beginner' | 'intermediate' | 'expert';

interface GameConfig {
  rows: number;
  cols: number;
  mines: number;
}

const DIFFICULTIES: Record<Difficulty, GameConfig> = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
};

type CellData = {
  x: number;
  y: number;
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  neighborMines: number;
  isExploded?: boolean;
  isFalseFlag?: boolean;
};

type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

const NUMBER_COLORS = [
  '',
  'text-cyan-400 drop-shadow-[0_0_2px_rgba(34,211,238,0.4)]',
  'text-emerald-400 drop-shadow-[0_0_2px_rgba(52,211,153,0.4)]',
  'text-rose-400 drop-shadow-[0_0_2px_rgba(251,113,133,0.4)]',
  'text-indigo-400 drop-shadow-[0_0_2px_rgba(129,140,248,0.4)]',
  'text-amber-400 drop-shadow-[0_0_2px_rgba(251,191,36,0.4)]',
  'text-teal-400 drop-shadow-[0_0_2px_rgba(45,212,191,0.4)]',
  'text-fuchsia-400 drop-shadow-[0_0_2px_rgba(232,121,249,0.4)]',
  'text-slate-400 drop-shadow-[0_0_2px_rgba(148,163,184,0.4)]'
];

const calculateScore = (diff: Difficulty, t: number) => {
  const base = diff === 'beginner' ? 10000 : diff === 'intermediate' ? 50000 : 150000;
  const penalty = t * (diff === 'beginner' ? 10 : diff === 'intermediate' ? 50 : 100);
  return Math.max(0, base - penalty);
};

const getNeighbors = (r: number, c: number, rows: number, cols: number) => {
  const neighbors: [number, number][] = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      const nr = r + i;
      const nc = c + j;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        neighbors.push([nr, nc]);
      }
    }
  }
  return neighbors;
};

export default function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const [board, setBoard] = useState<CellData[][]>([]);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [flagsCount, setFlagsCount] = useState(0);
  const [time, setTime] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [chordTarget, setChordTarget] = useState<{x: number, y: number} | null>(null);

  const config = DIFFICULTIES[difficulty];
  const currentScore = status === 'won' ? finalScore : (status === 'playing' ? calculateScore(difficulty, time) : 0);

  const initBoard = useCallback(() => {
    sound.init();
    const newBoard = Array.from({ length: config.rows }, (_, y) =>
      Array.from({ length: config.cols }, (_, x) => ({
        x,
        y,
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborMines: 0,
      }))
    );
    setBoard(newBoard);
    setStatus('idle');
    setFlagsCount(0);
    setTime(0);
    setFinalScore(0);
    setChordTarget(null);
  }, [config]);

  useEffect(() => {
    initBoard();
  }, [initBoard]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (status === 'playing') {
      timer = setInterval(() => setTime((t) => t + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [status]);

  const placeMines = (currentBoard: CellData[][], firstX: number, firstY: number) => {
    let minesPlaced = 0;
    while (minesPlaced < config.mines) {
      const r = Math.floor(Math.random() * config.rows);
      const c = Math.floor(Math.random() * config.cols);
      const isFirstClickArea = Math.abs(r - firstY) <= 1 && Math.abs(c - firstX) <= 1;
      
      if (!currentBoard[r][c].isMine && !isFirstClickArea) {
        currentBoard[r][c].isMine = true;
        minesPlaced++;
      }
    }

    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        if (!currentBoard[r][c].isMine) {
          let count = 0;
          getNeighbors(r, c, config.rows, config.cols).forEach(([nr, nc]) => {
            if (currentBoard[nr][nc].isMine) count++;
          });
          currentBoard[r][c].neighborMines = count;
        }
      }
    }
  };

  const revealCell = (currentBoard: CellData[][], x: number, y: number): boolean => {
    const cell = currentBoard[y][x];
    if (cell.isRevealed || cell.isFlagged) return false;

    cell.isRevealed = true;

    if (cell.isMine) {
      cell.isExploded = true;
      return true;
    }

    if (cell.neighborMines === 0) {
      const queue: [number, number][] = [[y, x]];
      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        getNeighbors(cr, cc, config.rows, config.cols).forEach(([nr, nc]) => {
          const neighbor = currentBoard[nr][nc];
          if (!neighbor.isRevealed && !neighbor.isFlagged) {
            neighbor.isRevealed = true;
            if (neighbor.neighborMines === 0) {
              queue.push([nr, nc]);
            }
          }
        });
      }
    }
    return false;
  };

  const chordCell = (currentBoard: CellData[][], x: number, y: number): { hitMine: boolean, revealedAny: boolean } => {
    const cell = currentBoard[y][x];
    if (!cell.isRevealed || cell.neighborMines === 0) return { hitMine: false, revealedAny: false };

    let flagCount = 0;
    const neighbors = getNeighbors(y, x, config.rows, config.cols);
    neighbors.forEach(([nr, nc]) => {
      if (currentBoard[nr][nc].isFlagged) flagCount++;
    });

    if (flagCount === cell.neighborMines) {
      let hitMine = false;
      let revealedAny = false;
      neighbors.forEach(([nr, nc]) => {
        const neighbor = currentBoard[nr][nc];
        if (!neighbor.isRevealed && !neighbor.isFlagged) {
          revealedAny = true;
          if (revealCell(currentBoard, nc, nr)) {
            hitMine = true;
          }
        }
      });
      return { hitMine, revealedAny };
    }
    return { hitMine: false, revealedAny: false };
  };

  const checkWin = (currentBoard: CellData[][]) => {
    let revealedCount = 0;
    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        if (currentBoard[r][c].isRevealed) revealedCount++;
      }
    }
    return revealedCount === config.rows * config.cols - config.mines;
  };

  const handleGameOver = (finalBoard: CellData[][]) => {
    setStatus('lost');
    finalBoard.forEach(row => row.forEach(c => {
      if (c.isMine && !c.isFlagged) {
        c.isRevealed = true;
      } else if (!c.isMine && c.isFlagged) {
        c.isRevealed = true;
        c.isFalseFlag = true;
      }
    }));
    setBoard(finalBoard);
  };

  const handleCellClick = (x: number, y: number) => {
    if (status === 'won' || status === 'lost') return;
    sound.init();

    let newBoard = board.map(row => row.map(c => ({ ...c })));
    let currentStatus = status;

    if (currentStatus === 'idle') {
      placeMines(newBoard, x, y);
      currentStatus = 'playing';
      setStatus('playing');
    }

    const cell = newBoard[y][x];

    if (cell.isFlagged) return;

    let revealedAny = false;

    if (cell.isRevealed) {
      const result = chordCell(newBoard, x, y);
      if (result.hitMine) {
        sound.playExplosion();
        handleGameOver(newBoard);
        return;
      }
      revealedAny = result.revealedAny;
    } else {
      const hitMine = revealCell(newBoard, x, y);
      if (hitMine) {
        sound.playExplosion();
        handleGameOver(newBoard);
        return;
      }
      revealedAny = true;
    }

    if (checkWin(newBoard)) {
      sound.playWin();
      setStatus('won');
      setFinalScore(calculateScore(difficulty, time));
      newBoard.forEach(row => row.forEach(c => {
        if (c.isMine && !c.isFlagged) c.isFlagged = true;
      }));
      setFlagsCount(config.mines);
    } else if (revealedAny) {
      if (cell.isRevealed) sound.playChord();
      else sound.playClick();
    }

    setBoard(newBoard);
  };

  const handleCellRightClick = (e: React.MouseEvent, x: number, y: number) => {
    e.preventDefault();
    if (status === 'won' || status === 'lost') return;
    sound.init();
    if (status === 'idle') {
      setStatus('playing');
    }

    const newBoard = board.map(row => row.map(c => ({ ...c })));
    const cell = newBoard[y][x];

    if (cell.isRevealed) return;

    if (!cell.isFlagged && flagsCount < config.mines) {
      cell.isFlagged = true;
      setFlagsCount(f => f + 1);
      sound.playFlag();
    } else if (cell.isFlagged) {
      cell.isFlagged = false;
      setFlagsCount(f => f - 1);
      sound.playUnflag();
    }

    setBoard(newBoard);
  };

  const handleMouseDown = (e: React.MouseEvent, x: number, y: number) => {
    if (e.buttons === 3 || e.buttons === 4) {
      e.preventDefault();
      setChordTarget({ x, y });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (chordTarget) {
      const { x, y } = chordTarget;
      setChordTarget(null);
      
      if (status === 'won' || status === 'lost') return;
      sound.init();
      
      let newBoard = board.map(row => row.map(c => ({ ...c })));
      const { hitMine, revealedAny } = chordCell(newBoard, x, y);
      
      if (hitMine) {
        sound.playExplosion();
        handleGameOver(newBoard);
        return;
      }
      
      if (checkWin(newBoard)) {
        sound.playWin();
        setStatus('won');
        setFinalScore(calculateScore(difficulty, time));
        newBoard.forEach(row => row.forEach(c => {
          if (c.isMine && !c.isFlagged) c.isFlagged = true;
        }));
        setFlagsCount(config.mines);
      } else if (revealedAny) {
        sound.playChord();
      }
      
      setBoard(newBoard);
    }
  };

  const isNeighborOfChordTarget = (x: number, y: number) => {
    if (!chordTarget) return false;
    return Math.abs(chordTarget.x - x) <= 1 && Math.abs(chordTarget.y - y) <= 1;
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] flex flex-col items-center justify-center p-4 font-sans select-none" onMouseUp={handleMouseUp} onMouseLeave={() => setChordTarget(null)}>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#111827] p-4 sm:p-6 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-slate-800 max-w-full overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-tight">
            Minesweeper
          </h1>
          <div className="flex gap-2 bg-[#0B0F19] p-1 rounded-lg border border-slate-800">
            {(['beginner', 'intermediate', 'expert'] as Difficulty[]).map((diff) => (
              <button
                key={diff}
                onClick={() => setDifficulty(diff)}
                className={`px-3 sm:px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                  difficulty === diff 
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800 border border-transparent'
                }`}
              >
                {diff}
              </button>
            ))}
          </div>
        </div>

        {/* Dashboard */}
        <div className="flex items-center justify-between bg-[#0B0F19] text-slate-200 p-3 sm:p-4 rounded-xl mb-6 border border-slate-800 shadow-inner">
          <div className="flex flex-col items-center w-16 sm:w-20">
            <div className="flex items-center gap-1 text-slate-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">
              <Flag className="w-3 h-3"/> Flags
            </div>
            <span className="text-xl sm:text-2xl font-mono font-semibold text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.5)]">
              {String(config.mines - flagsCount).padStart(3, '0')}
            </span>
          </div>

          <div className="flex flex-col items-center w-20 sm:w-24">
            <div className="flex items-center gap-1 text-slate-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">
              <Trophy className="w-3 h-3"/> Score
            </div>
            <span className="text-xl sm:text-2xl font-mono font-semibold text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]">
              {String(currentScore).padStart(5, '0')}
            </span>
          </div>

          <button 
            onClick={initBoard}
            className="p-2 sm:p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-all active:scale-95 shadow-lg"
          >
            {status === 'lost' ? <Frown className="w-6 h-6 sm:w-8 sm:h-8 text-rose-500" /> :
             status === 'won' ? <Smile className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-400" /> :
             <Meh className="w-6 h-6 sm:w-8 sm:h-8 text-cyan-400" />}
          </button>

          <div className="flex flex-col items-center w-16 sm:w-20">
            <div className="flex items-center gap-1 text-slate-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">
              <Clock className="w-3 h-3"/> Time
            </div>
            <span className="text-xl sm:text-2xl font-mono font-semibold text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
              {String(time).padStart(3, '0')}
            </span>
          </div>
        </div>

        {/* Game Board */}
        <div className="w-full overflow-x-auto pb-2 sm:pb-4 flex justify-center custom-scrollbar">
          <div 
            className="bg-[#0B0F19] p-2 sm:p-3 rounded-xl border border-slate-800 shadow-inner inline-block min-w-max"
            onContextMenu={(e) => e.preventDefault()}
          >
            <div 
              className="grid gap-[2px]"
              style={{ 
                gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))` 
              }}
            >
              {board.map((row, y) => 
                row.map((cell, x) => {
                  const isChordHighlight = !cell.isRevealed && !cell.isFlagged && isNeighborOfChordTarget(x, y);
                  
                  return (
                    <div
                      key={`${x}-${y}`}
                      onClick={() => handleCellClick(x, y)}
                      onContextMenu={(e) => handleCellRightClick(e, x, y)}
                      onMouseDown={(e) => handleMouseDown(e, x, y)}
                      className={`
                        w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-sm sm:text-base font-bold rounded-sm transition-all duration-75 select-none
                        ${cell.isRevealed 
                          ? cell.isExploded 
                            ? 'bg-rose-950/80 border border-rose-500 animate-mine-pulse z-10 relative' 
                            : 'bg-[#0B0F19] border border-slate-800/50 shadow-inner'
                          : isChordHighlight
                            ? 'bg-slate-700 border-t border-l border-slate-600 border-b border-r border-slate-800'
                            : 'bg-slate-800 border-t border-l border-slate-700 border-b border-r border-slate-900 hover:bg-slate-700'
                        }
                      `}
                    >
                      {cell.isRevealed ? (
                        cell.isMine ? (
                          <Bomb className={`w-4 h-4 sm:w-5 sm:h-5 ${cell.isExploded ? 'text-rose-400' : 'text-slate-600'}`} />
                        ) : cell.isFalseFlag ? (
                          <div className="relative">
                            <Bomb className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 opacity-50" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-full h-0.5 bg-rose-500 rotate-45 absolute"></div>
                              <div className="w-full h-0.5 bg-rose-500 -rotate-45 absolute"></div>
                            </div>
                          </div>
                        ) : cell.neighborMines > 0 ? (
                          <span className={NUMBER_COLORS[cell.neighborMines]}>
                            {cell.neighborMines}
                          </span>
                        ) : null
                      ) : cell.isFlagged ? (
                        <Flag className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500 fill-rose-500 drop-shadow-[0_0_3px_rgba(244,63,94,0.6)]" />
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-4 sm:mt-6 text-center text-xs sm:text-sm text-slate-500 flex flex-col gap-1">
          <p><strong className="text-slate-400">Left Click</strong> to reveal a cell.</p>
          <p><strong className="text-slate-400">Right Click</strong> to place a flag.</p>
          <p><strong className="text-slate-400">Left + Right Click</strong> (or click a revealed number) to chord.</p>
        </div>
      </motion.div>
    </div>
  );
}
