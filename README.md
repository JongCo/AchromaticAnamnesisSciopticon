# AchromaticAnamnesisSciopticon

Vite + React + TypeScript + Canvas 2D로 만든 AchromaticAnamnesisSciopticon MIDI 피아노 연습 앱입니다. 모든 반음이 같은 폭의 isomorphic key로 표시되고, MIDI 파일의 낙하 노트를 Web MIDI 입력으로 따라 칠 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

Electron 데스크톱 앱으로 실행:

```bash
npm run desktop:dev
```

프로덕션 빌드:

```bash
npm run build
```

Electron 패키징:

```bash
npm run desktop:dist
```

## 주요 기능

- MIDI 파일 업로드 및 `@tonejs/midi` 기반 파싱
- 트랙 선택: 선택 트랙과 활성 키 범위 안의 노트는 직접 연주 대상, 나머지는 자동 재생
- Web MIDI API 입력 장치 선택 및 note on/off 처리
- Canvas 2D 피아노 롤 렌더링
- 88건반 범위의 동일 폭 isomorphic 키보드
- 활성 키 범위 수동 설정 및 MIDI 캘리브레이션
- 게임모드: 시작틱 판정, miss/fail 중복 방지, 너무 빠른 note-off 실패 처리
- 연습모드: 같은 start tick의 노트 그룹을 하나씩 입력받고 완료 후 진행
- Playback Speed와 Scroll Speed 분리
- Input Offset, Judgement Offset, Judgement Window 설정
- AB 반복 및 tempo map 기반 rest beats
- 내장 `MuseScore_General.sf3` SoundFont와 AudioWorklet 기반 오프라인 재생
- General MIDI 128개 악기 선택
- 주요 설정 `localStorage` 저장

## 내장 SoundFont

앱은 `public/soundfonts/MuseScore_General.sf3`를 패키지에 포함하며 음정별 샘플을 인터넷에서 내려받지 않습니다. SoundFont 저작자 표시와 MIT 라이선스는 같은 폴더의 `MuseScore_General_License.md`에 있습니다.

## 브라우저

Web MIDI API는 Chrome / Edge 계열 브라우저를 대상으로 합니다. 지원하지 않는 브라우저에서는 앱 안에 안내 메시지가 표시됩니다.
