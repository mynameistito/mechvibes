import { useState, useEffect, useRef, useCallback } from 'react';
import fs from 'fs';
import { shell } from 'electron';
import Store from 'electron-store';
import remapper from '../../shared/remapper';
import { win32 as layoutWin32, darwin as layoutDarwin, linux as layoutLinux, sizes } from '../../shared/layouts';
import { win32 as kcWin32, darwin as kcDarwin, linux as kcLinux } from '../../shared/keycodes';
import type { Platform, KeyDefines } from '../../shared/keycodes';

const _store = new Store();
const _layouts = { win32: layoutWin32, darwin: layoutDarwin, linux: layoutLinux } as Record<string, typeof layoutWin32>;
const _kcs = { win32: kcWin32, darwin: kcDarwin, linux: kcLinux } as Record<string, typeof kcWin32>;
const layout = _layouts[process.platform] ?? layoutWin32;
const os_keycode = _kcs[process.platform] ?? kcWin32;

const KEY_BASE = 50;
const KEY_SIZES: Record<string, React.CSSProperties> = {
  'key-125u': { width: KEY_BASE * 1.25 },
  'key-15u': { width: KEY_BASE * 1.5 },
  'key-175u': { width: KEY_BASE * 1.75 },
  'key-2u': { width: KEY_BASE * 2 },
  'key-225u': { width: KEY_BASE * 2.25 },
  'key-275u': { width: KEY_BASE * 2.75 },
  'key-625u': { width: KEY_BASE * 6.25 },
  'key-height-2u': { height: KEY_BASE * 2, zIndex: 99 },
};

type DefineValue = [number, number] | string | null;

interface PackData {
  id: string;
  name: string;
  key_define_type: 'single' | 'multi';
  includes_numpad: boolean;
  sound: string;
  defines: Record<string, DefineValue>;
}

function makeDefaultPack(): PackData {
  return {
    id: `custom-sound-pack-${Date.now()}`,
    name: 'Untitled',
    key_define_type: 'single',
    includes_numpad: false,
    sound: 'sound.ogg',
    defines: Object.fromEntries(Object.keys(os_keycode).map(kc => [kc, null])),
  };
}

interface KeyCellProps {
  keycode: number;
  isSelected: boolean;
  isHidden: boolean;
  hasSound: boolean;
  keyDefineMode: 'single' | 'multi';
  define: DefineValue;
  upPopover: boolean;
  leftPopover: boolean;
  onSelect: (kc: number) => void;
  onClose: () => void;
  onSave: (kc: number, value: DefineValue) => void;
}

function KeyCell({ keycode, isSelected, isHidden, hasSound, keyDefineMode, define, upPopover, leftPopover, onSelect, onClose, onSave }: KeyCellProps) {
  const startRef = useRef<HTMLInputElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSelected) return;
    if (keyDefineMode === 'single' && Array.isArray(define)) {
      if (startRef.current) startRef.current.value = String(define[0]);
      if (lengthRef.current) lengthRef.current.value = String(define[1]);
    } else if (keyDefineMode === 'multi' && typeof define === 'string') {
      if (fileRef.current) fileRef.current.value = define;
    } else {
      if (startRef.current) startRef.current.value = '';
      if (lengthRef.current) lengthRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [isSelected, define, keyDefineMode]);

  const handleSave = useCallback(() => {
    if (keyDefineMode === 'single') {
      onSave(keycode, [Number(startRef.current?.value ?? 0), Number(lengthRef.current?.value ?? 0)]);
    } else {
      onSave(keycode, fileRef.current?.value ?? '');
    }
    onClose();
  }, [keycode, keyDefineMode, onSave, onClose]);

  const sizeStyle = KEY_SIZES[sizes[keycode] ?? ''] ?? {};

  const bgClass = isSelected
    ? 'bg-[#f5b6b6] dark:bg-[#5a2a2a]'
    : hasSound
    ? 'bg-[#defbde] dark:bg-[#1a3a1a]'
    : 'bg-white dark:bg-[#2a2a2a]';

  return (
    <div
      id={`key-${keycode}`}
      className={[
        'cursor-pointer text-[13px] outline outline-1 outline-[#333] w-[50px] h-[50px] relative',
        'hover:bg-[#ffe0e0] dark:hover:bg-[#3a1a1a]',
        'dark:outline-[#555] dark:text-[#e0e0e0]',
        bgClass,
        isHidden ? 'opacity-20' : '',
        isSelected ? 'z-[100]' : '',
      ].filter(Boolean).join(' ')}
      style={sizeStyle}
      data-keycode={keycode}
      onClick={() => onSelect(keycode)}
    >
      <div className="absolute top-[5px] left-[5px]">{os_keycode[keycode] ?? ''}</div>
      {isSelected && (
        <div
          className={[
            'absolute bg-white dark:bg-[#242424] dark:text-[#e0e0e0] border border-black dark:border-[#555] p-[10px] z-[999] min-w-[250px]',
            upPopover ? 'bottom-[50px]' : 'top-[50px]',
            leftPopover ? 'right-[-1px]' : 'left-[-1px]',
          ].join(' ')}
          onClick={e => e.stopPropagation()}
        >
          {keyDefineMode === 'single' && (
            <div className="mb-[10px]">
              <div className="mb-[5px]">Set start and length (ms)</div>
              <div className="flex">
                <input ref={startRef} type="number" placeholder="Start..." className="mr-[10px] w-1/2 dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]" />
                <input ref={lengthRef} type="number" placeholder="Length..." className="w-1/2 dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]" />
              </div>
            </div>
          )}
          {keyDefineMode === 'multi' && (
            <div className="mb-[10px]">
              <div className="mb-[5px]">Enter audio file name:</div>
              <input ref={fileRef} type="text" placeholder="Sound file name..." className="w-[95%] mr-[10px] dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]" />
            </div>
          )}
          <div className="flex justify-between">
            <button onClick={handleSave} className="dark:bg-[#242424] dark:border-[#444] dark:text-[#e0e0e0]">Save</button>
            <button onClick={onClose} className="dark:bg-[#242424] dark:border-[#444] dark:text-[#e0e0e0]">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface KeyboardGridProps {
  packData: PackData;
  selectedKeycode: number | null;
  keyDefineMode: 'single' | 'multi';
  onSelectKey: (kc: number) => void;
  onClosePopover: () => void;
  onSaveDefine: (kc: number, value: DefineValue) => void;
}

function KeyboardGrid({ packData, selectedKeycode, keyDefineMode, onSelectKey, onClosePopover, onSaveDefine }: KeyboardGridProps) {
  return (
    <div id="kb" className="flex mb-[30px]">
      {(['main', 'edit', 'numpad'] as const).map(zone => (
        <div key={zone} id={`zone-${zone}`} className={zone !== 'numpad' ? 'mr-[15px]' : ''}>
          {layout[zone].map((row, rowIdx) => (
            <div key={rowIdx} className={`flex h-[50px] ${rowIdx === 0 ? 'mb-[15px]' : ''}`}>
              {(row as (number | number[])[]).map((item, ki) => {
                const keycode = Array.isArray(item) ? item[0] : item;
                if (keycode === 0) {
                  return <div key={ki} className="w-[50px] h-[50px] opacity-0 cursor-default" />;
                }
                return (
                  <KeyCell
                    key={keycode}
                    keycode={keycode}
                    isSelected={selectedKeycode === keycode}
                    isHidden={selectedKeycode !== null && selectedKeycode !== keycode}
                    hasSound={packData.defines[String(keycode)] != null}
                    keyDefineMode={keyDefineMode}
                    define={packData.defines[String(keycode)]}
                    upPopover={rowIdx > 3}
                    leftPopover={zone === 'numpad'}
                    onSelect={onSelectKey}
                    onClose={onClosePopover}
                    onSave={onSaveDefine}
                  />
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface ManualListProps {
  packData: PackData;
  keyDefineMode: 'single' | 'multi';
  onDefineChange: (kcStr: string, type: 'start' | 'length' | 'file', value: string) => void;
}

function ManualList({ packData, keyDefineMode, onDefineChange }: ManualListProps) {
  return (
    <div className="flex mb-[50px]">
      {(['main', 'edit', 'numpad'] as const).map((zone, zi) => (
        <div
          key={zone}
          id={`pack-zone-${zone}`}
          className={[
            'w-1/4',
            zi === 0 ? 'pr-[10px] border-r border-[#e4e4e4] dark:border-[#333]' : '',
            zi === 1 ? 'px-[10px] border-r border-[#e4e4e4] dark:border-[#333]' : '',
            zi === 2 ? 'px-[10px]' : '',
          ].filter(Boolean).join(' ')}
        >
          {(layout[zone].flat() as (number | number[])[])
            .map(item => Array.isArray(item) ? item[0] : item)
            .filter(kc => kc !== 0)
            .map(keycode => {
              const kcStr = String(keycode);
              const val = packData.defines[kcStr];
              return (
                <div
                  key={keycode}
                  className={`border-b border-[#eee] dark:border-[#333] p-[10px] flex justify-between items-center ${val != null ? 'bg-[#defbde] dark:bg-[#1a3a1a]' : ''}`}
                >
                  <div className="font-bold mr-[10px]">{os_keycode[keycode]}</div>
                  {keyDefineMode === 'single' ? (
                    <div className="flex">
                      <input
                        type="number"
                        placeholder="Start..."
                        className="mr-[5px] w-[60px] dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
                        value={Array.isArray(val) ? val[0] : ''}
                        onChange={e => onDefineChange(kcStr, 'start', e.target.value)}
                      />
                      <input
                        type="number"
                        placeholder="Length..."
                        className="w-[60px] dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
                        value={Array.isArray(val) ? val[1] : ''}
                        onChange={e => onDefineChange(kcStr, 'length', e.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="File name..."
                      className="w-full mr-[5px] dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
                      value={typeof val === 'string' ? val : ''}
                      onChange={e => onDefineChange(kcStr, 'file', e.target.value)}
                    />
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

export function EditorWindow() {
  const [packData, setPackData] = useState<PackData>(makeDefaultPack);
  const [selectedKeycode, setSelectedKeycode] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<'visual' | 'manual'>('visual');
  const [keyDefineMode, setKeyDefineMode] = useState<'single' | 'multi'>('single');
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = _store.get('mechvibes-theme', 'system') as string;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (savedTheme === 'system' && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const saveDefine = useCallback((kc: number, value: DefineValue) => {
    setPackData(prev => ({ ...prev, defines: { ...prev.defines, [String(kc)]: value } }));
    setSelectedKeycode(null);
  }, []);

  const updateDefine = useCallback((kcStr: string, type: 'start' | 'length' | 'file', value: string) => {
    setPackData(prev => {
      const newDefines = { ...prev.defines };
      if (type === 'file') {
        newDefines[kcStr] = value || null;
      } else {
        const existing = Array.isArray(newDefines[kcStr]) ? (newDefines[kcStr] as [number, number]) : [0, 0];
        newDefines[kcStr] = type === 'start' ? [Number(value), existing[1]] : [existing[0], Number(value)];
      }
      return { ...prev, defines: newDefines };
    });
  }, []);

  const handleNew = useCallback(() => {
    setPackData(makeDefaultPack());
    setSelectedKeycode(null);
  }, []);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = fs.readFileSync((file as File & { path: string }).path);
    const imported = JSON.parse(buffer.toString()) as PackData;
    const remapped: PackData = {
      ...imported,
      defines: remapper('standard', process.platform as Platform, imported.defines as KeyDefines) as PackData['defines'],
    };
    setPackData(remapped);
    setKeyDefineMode(imported.key_define_type || 'single');
    e.target.value = '';
  }, []);

  const handleExport = useCallback(() => {
    const exported = {
      ...packData,
      defines: remapper(process.platform as Platform, 'standard', packData.defines as KeyDefines) as PackData['defines'],
    };
    const a = document.createElement('a');
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'text/plain' });
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [packData]);

  const handleKeyDefineMode = useCallback((val: 'single' | 'multi') => {
    setKeyDefineMode(val);
    setPackData(prev => ({
      ...prev,
      key_define_type: val,
      defines: Object.fromEntries(Object.keys(prev.defines).map(kc => [kc, null])),
    }));
  }, []);

  const resultJson = JSON.stringify(
    { ...packData, defines: remapper(process.platform as Platform, 'standard', packData.defines as KeyDefines) as PackData['defines'] },
    null,
    2,
  );

  return (
    <div className="mx-auto w-[1150px] font-sans text-[13px] dark:text-[#e0e0e0]">
      <div className="border-b border-[#ccc] dark:border-[#333] py-5 mb-[30px] flex justify-between items-center">
        <div className="mr-[10px]">
          <img src="../../assets/icon.png" alt="" className="w-[60px]" />
        </div>
        <div className="w-full">
          <h1 className="m-0">Editor</h1>
          <div className="text-[#666] text-[14px] dark:text-[#aaa]">
            Create, edit, share your sound pack!{' '}
            <a
              href="#"
              onClick={e => { e.preventDefault(); shell.openExternal('https://mechvibes.com/say-hi-to-mechvibes-editor/'); }}
              className="dark:text-[#ff6b6b]"
            >
              How to?
            </a>
          </div>
        </div>
        <div className="w-[70%] text-right">
          <button onClick={handleNew}>New</button>
          <button className="ml-1" onClick={() => importInputRef.current?.click()}>Import</button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button className="ml-1" onClick={handleExport}>Export</button>
        </div>
      </div>

      <div className="mb-[30px]">
        <div className="flex mb-[10px]">
          <div className="pr-[10px] border-r border-[#e4e4e4] dark:border-[#333]">
            <label className="block">Pack name</label>
            <input
              type="text"
              placeholder="Pack name..."
              className="w-[250px] dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
              value={packData.name}
              onChange={e => setPackData(prev => ({ ...prev, name: e.target.value || 'Untitled' }))}
            />
          </div>
          <div className="px-[10px] border-r border-[#e4e4e4] dark:border-[#333]">
            <label className="block">Edit mode</label>
            <select
              className="dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
              value={editMode}
              onChange={e => setEditMode(e.target.value as 'visual' | 'manual')}
            >
              <option value="visual">Visual (select on keyboard)</option>
              <option value="manual">Manual (edit on key list)</option>
            </select>
          </div>
          <div className="px-[10px] border-r border-[#e4e4e4] dark:border-[#333]">
            <label className="block">Key define mode</label>
            <select
              className="dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
              value={keyDefineMode}
              onChange={e => handleKeyDefineMode(e.target.value as 'single' | 'multi')}
            >
              <option value="single">Single file (Determine time start and length)</option>
              <option value="multi">Multiple files (Use one sound file for one key)</option>
            </select>
          </div>
          <div className="pl-[10px]">
            <label className="block">Sound file</label>
            <input
              type="text"
              placeholder="Sound file name..."
              className="dark:bg-[#242424] dark:text-[#e0e0e0] dark:border-[#444]"
              value={packData.sound}
              onChange={e => setPackData(prev => ({ ...prev, sound: e.target.value || 'sound.ogg' }))}
            />
          </div>
        </div>
      </div>

      {editMode === 'visual' ? (
        <KeyboardGrid
          packData={packData}
          selectedKeycode={selectedKeycode}
          keyDefineMode={keyDefineMode}
          onSelectKey={kc => setSelectedKeycode(prev => (prev === kc ? null : kc))}
          onClosePopover={() => setSelectedKeycode(null)}
          onSaveDefine={saveDefine}
        />
      ) : (
        <ManualList
          packData={packData}
          keyDefineMode={keyDefineMode}
          onDefineChange={updateDefine}
        />
      )}

      <div className="mt-[30px] mb-[50px]">
        <pre className="text-[11px] bg-[#f5f5f5] dark:bg-[#111] p-[10px] overflow-auto max-h-[200px] rounded">{resultJson}</pre>
      </div>
    </div>
  );
}
