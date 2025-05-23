import { Reducer, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform } from 'react-native';
import { Navigation, NavigationButtonPressedEvent, ComponentDidAppearEvent, ComponentDidDisappearEvent, NavigationConstants } from 'react-native-navigation';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { forEach, findIndex, flatMap, debounce, find, uniq, keys } from 'lodash';

import { CampaignCycleCode, DeckId, MiscLocalSetting, MiscRemoteSetting, MiscSetting, Slots, SortType } from '@actions/types';
import Card, { CardsMap, InvestigatorChoice } from '@data/types/Card';
import { useDispatch, useSelector } from 'react-redux';
import {
  AppState,
  makeTabooSetSelector,
} from '@reducers';
import DatabaseContext from '@data/sqlite/DatabaseContext';
import { fetchPrivateDeck } from '@components/deck/actions';
import { campaignScenarios, Scenario } from '@components/campaign/constants';
import TabooSet from '@data/types/TabooSet';
import ArkhamCardsAuthContext from '@lib/ArkhamCardsAuthContext';
import { DeckActions } from '@data/remote/decks';
import SingleCampaignT from '@data/interfaces/SingleCampaignT';
import { useDeck } from '@data/hooks';
import LatestDeckT from '@data/interfaces/LatestDeckT';
import { useDebounce } from 'use-debounce/lib';
import useCardsFromQuery from '@components/card/useCardsFromQuery';
import { useCardMap } from '@components/card/useCardList';
import { combineQueries, INVESTIGATOR_CARDS_QUERY, NO_CUSTOM_CARDS_QUERY, where } from '@data/sqlite/query';
import { PlayerCardContext } from '@data/sqlite/PlayerCardContext';
import { setMiscSetting } from '@components/settings/actions';
import specialCards from '@data/deck/specialCards';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from '@components/Toast';
import { RANDOM_BASIC_WEAKNESS } from '@app_constants';
import { useAppDispatch } from '@app/store';

export function useBackButton(handler: () => boolean) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => {
      sub.remove();
    };
  }, [handler]);
}

export function useNavigationConstants(): Partial<NavigationConstants> {
  const [constants, setConstants] = useState<NavigationConstants>();
  useEffect(() => {
    let canceled = false;
    Navigation.constants().then(r => {
      if (!canceled) {
        setConstants(r);
      }
    });
    return () => {
      canceled = true;
    };
  }, []);
  return constants || {};
}
export function useNavigationButtonPressed(
  handler: (event: NavigationButtonPressedEvent) => void,
  componentId: string,
  deps: any[],
  debounceDelay: number = 300
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  const debouncedHandler = useMemo(() => debounce((event: NavigationButtonPressedEvent) => handlerRef.current && handlerRef.current(event), debounceDelay, { leading: true, trailing: false }), [debounceDelay]);
  useEffect(() => {
    const sub = Navigation.events().registerNavigationButtonPressedListener((event: NavigationButtonPressedEvent) => {
      if (event.componentId === componentId) {
        debouncedHandler(event);
      }
    });
    return () => {
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, debouncedHandler, ...deps]);
}

export function useComponentVisible(componentId: string): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const appearSub = Navigation.events().registerComponentDidAppearListener((event: ComponentDidAppearEvent) => {
      if (event.componentId === componentId) {
        setVisible(true);
      }
    });
    const disappearSub = Navigation.events().registerComponentDidDisappearListener((event: ComponentDidDisappearEvent) => {
      if (event.componentId === componentId) {
        setVisible(false);
      }
    });
    return () => {
      appearSub.remove();
      disappearSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, setVisible]);
  return visible;
}

export function useComponentDidAppear(
  handler: (event: ComponentDidAppearEvent) => void,
  componentId: string,
  deps: any[],
) {
  useEffect(() => {
    const sub = Navigation.events().registerComponentDidAppearListener((event: ComponentDidAppearEvent) => {
      if (event.componentId === componentId) {
        handler(event);
      }
    });
    return () => {
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, handler, ...deps]);
}


export function useComponentDidDisappear(
  handler: (event: ComponentDidDisappearEvent) => void,
  componentId: string,
  deps: any[],
) {
  useEffect(() => {
    const sub = Navigation.events().registerComponentDidDisappearListener((event: ComponentDidDisappearEvent) => {
      if (event.componentId === componentId) {
        handler(event);
      }
    });
    return () => {
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, handler, ...deps]);
}


interface IncAction {
  type: 'inc';
}
interface DecAction {
  type: 'dec';
}
interface SetAction {
  type: 'set';
  value: number;
}
interface CleanAction {
  type: 'clean';
  value: number;
}
export function useCounter(
  initialValue: number,
  { min, max, hapticFeedback }: { min?: number; max?: number, hapticFeedback?: boolean },
  syncValue?: (value: number) => void
): [number, () => void, () => void, (value: number) => void] {
  const [currentState, updateValue] = useReducer((state: { value: number; dirty: boolean }, action: IncAction | DecAction | SetAction | CleanAction) => {
    switch (action.type) {
      case 'set':
        return {
          value: action.value,
          dirty: true,
        };
      case 'inc': {
        const newValue = max ? Math.min(max, state.value + 1) : (state.value + 1);
        if (newValue > state.value && hapticFeedback) {
          ReactNativeHapticFeedback.trigger('impactMedium');
        }
        return {
          value: newValue,
          dirty: true,
        };
      }
      case 'dec': {
        const newValue = min ? Math.max(min, state.value - 1) : (state.value - 1);
        if (newValue < state.value && hapticFeedback) {
          ReactNativeHapticFeedback.trigger('impactLight');
        }
        return {
          value: newValue,
          dirty: true,
        };
      }
      case 'clean':
        return {
          value: state.value,
          dirty: state.value !== action.value,
        };
    }
  }, { value: initialValue, dirty: false });
  const { value, dirty } = currentState;
  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;
  useEffect(() => {
    return () => {
      if (syncValue && currentStateRef.current.dirty) {
        syncValue(currentStateRef.current.value);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [debounceValue] = useDebounce(value, 200, { trailing: true });
  useEffectUpdate(() => {
    if (syncValue && dirty) {
      syncValue(value);
      updateValue({ type: 'clean', value });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounceValue]);
  const inc = useCallback(() => {
    updateValue({ type: 'inc' });
  }, [updateValue]);
  const dec = useCallback(() => {
    updateValue({ type: 'dec' });
  }, [updateValue]);
  const set = useCallback((value: number) => {
    updateValue({ type: 'set', value });
  }, [updateValue]);
  return [value, inc, dec, set];
}


interface IncCountAction {
  type: 'inc';
  key: string;
  max?: number;
}
interface DecCountAction {
  type: 'dec';
  key: string;
  min?: number;
}

interface SetCountAction {
  type: 'set';
  key: string;
  value: number;
}
interface SyncCountAction {
  type: 'sync';
  values: Counters;
}
export interface Counters {
  [code: string]: number | undefined;
}

type IncCounter = (code: string, max?: number) => void;
type DecCounter = (code: string, min?: number) => void;
type SetCounter = (code: string, value: number) => void;
type ResetCounters = (values: Counters) => void;
type CheckConstraints = (code: string, values: Counters) => Counters;
export function useCounters(initialValue: Counters, extra?: {
  checkConstraints?: CheckConstraints;
  onChange?: (values: Counters) => void;
}): [Counters, IncCounter, DecCounter, SetCounter, ResetCounters] {
  const [value, updateValue] = useReducer((
    state: Counters,
    action: IncCountAction | DecCountAction | SetCountAction | SyncCountAction
  ) => {
    switch (action.type) {
      case 'set':
        let newState = {
          ...state,
          [action.key]: action.value,
        };

        if (extra?.checkConstraints) {
          newState = extra.checkConstraints(action.key, newState);
        }
        if (extra?.onChange) {
          extra.onChange(newState);
        }
        return newState;
      case 'inc': {
        const newValue = (state[action.key] || 0) + 1;
        let newState = {
          ...state,
          [action.key]: action.max !== undefined ? Math.min(action.max, newValue) : newValue,
        };
        if (extra?.checkConstraints) {
          newState = extra.checkConstraints(action.key, newState);
        }
        if (extra?.onChange) {
          extra.onChange(newState);
        }
        return newState;
      }
      case 'dec': {
        let newState = {
          ...state,
          [action.key]: Math.max(action.min || 0, (state[action.key] || 0) - 1),
        };
        if (extra?.checkConstraints) {
          newState = extra.checkConstraints(action.key, newState);
        }
        if (extra?.onChange) {
          extra.onChange(newState);
        }
        return newState;
      }
      case 'sync':
        return {
          ...action.values,
        };
    }
  }, initialValue);
  const inc = useCallback((code: string, max?: number) => {
    updateValue({ type: 'inc', key: code, max });
  }, [updateValue]);
  const dec = useCallback((code: string, min?: number) => {
    updateValue({ type: 'dec', key: code, min });
  }, [updateValue]);
  const set = useCallback((code: string, value: number) => {
    updateValue({ type: 'set', key: code, value });
  }, [updateValue]);
  const sync = useCallback((values: Counters) => {
    updateValue({ type: 'sync', values });
  }, [updateValue]);
  return [value, inc, dec, set, sync];
}

export interface Toggles {
  [key: string]: boolean | undefined;
}

interface ClearAction {
  type: 'clear';
  state?: Toggles;
}

interface SetToggleAction {
  type: 'set';
  key: string | number;
  value: boolean;
}

interface ToggleAction {
  type: 'toggle';
  key: string;
}

interface RemoveAction {
  type: 'remove';
  key: string;
}

type SectionToggleAction = SetToggleAction | ToggleAction | ClearAction | RemoveAction;


export function useToggles(initialState: (Toggles) | (() => Toggles), sync?: (toggles: Toggles) => void): [
  Toggles,
  (code: string) => void,
  (code: string | number, value: boolean) => void,
  (state?: Toggles) => void,
  (code: string) => void,
] {
  const [toggles, updateToggles] = useReducer((state: Toggles, action: SectionToggleAction) => {
    switch (action.type) {
      case 'clear':
        return action.state || (typeof initialState === 'function' ? initialState() : initialState);
      case 'remove': {
        const newState = { ...state };
        delete newState[action.key];
        return newState;
      }
      case 'set':
        return {
          ...state,
          [action.key]: action.value,
        };
      case 'toggle':
        return {
          ...state,
          [action.key]: !state[action.key],
        };
    }
  }, null, () => typeof initialState === 'function' ? initialState() : initialState);
  useEffect(() => {
    sync?.(toggles);
  }, [sync, toggles]);
  const toggle = useCallback((code: string) => updateToggles({ type: 'toggle', key: code }), [updateToggles]);
  const set = useCallback((code: string | number, value: boolean) => updateToggles({ type: 'set', key: code, value }), [updateToggles]);
  const clear = useCallback((state?: Toggles) => updateToggles({ type: 'clear', state }), [updateToggles]);
  const remove = useCallback((code: string) => updateToggles({ type: 'remove', key: code }), [updateToggles]);
  return [toggles, toggle, set, clear, remove];
}

export function useFlag(initialValue: boolean): [boolean, () => void, (value: boolean) => void] {
  const [value, updateState] = useReducer((state: boolean, action: { type: 'toggle' } | { type: 'set', value: boolean }) => {
    switch (action.type) {
      case 'toggle':
        return !state;
      case 'set':
        return action.value;
    }
  }, initialValue);
  const toggle = useCallback(() => updateState({ type: 'toggle' }), [updateState]);
  const set = useCallback((value: boolean) => updateState({ type: 'set', value }), [updateState]);
  return [value, toggle, set];
}

export const useKeyboardHeight = (): [number] => {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  function onKeyboardDidShow(e: any): void {
    setKeyboardHeight(e.endCoordinates.height);
  }

  function onKeyboardDidHide(): void {
    setKeyboardHeight(0);
  }

  useEffect(() => {
    const sub1 = Keyboard.addListener('keyboardDidShow', onKeyboardDidShow);
    const sub2 = Keyboard.addListener('keyboardDidHide', onKeyboardDidHide);
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, []);

  return [keyboardHeight];
};

interface ClearAction {
  type: 'clear';
}

interface SlotAction {
  type: 'set-slot';
  code: string;
  value: number;
}

interface SyncAction {
  type: 'sync';
  slots: Slots;
}

interface IncSlotAction {
  type: 'inc-slot';
  code: string;
  max?: number;
}

interface DecSlotAction {
  type: 'dec-slot';
  code: string;
}

export type SlotsAction = SlotAction | IncSlotAction | DecSlotAction | ClearAction | SyncAction;

export function useSlots(initialState: Slots, updateSlots?: (slots: Slots) => void, keepZero?: boolean) {
  return useReducer((state: Slots, action: SlotsAction) => {
    switch (action.type) {
      case 'clear':
        updateSlots && updateSlots(initialState);
        return initialState;
      case 'sync':
        // Intentionally do not update on this one.
        return action.slots;
      case 'set-slot': {
        const newState = {
          ...state,
          [action.code]: action.value,
        };
        if (!newState[action.code] && !keepZero) {
          delete newState[action.code];
        }
        updateSlots && updateSlots(newState);
        return newState;
      }
      case 'inc-slot': {
        const newState = {
          ...state,
          [action.code]: (state[action.code] || 0) + 1,
        };
        if (action.max && newState[action.code] > action.max) {
          newState[action.code] = action.max;
        }
        updateSlots && updateSlots(newState);
        return newState;
      }
      case 'dec-slot': {
        const newState = {
          ...state,
          [action.code]: (state[action.code] || 0) - 1,
        };
        if (newState[action.code] <= 0 && !keepZero) {
          delete newState[action.code];
        }
        updateSlots && updateSlots(newState);
        return newState;
      }
    }
  }, initialState);
}


export interface EditSlotsActions {
  setSlot: (code: string, count: number) => void;
  incSlot: (code: string, max?: number) => void;
  decSlot: (code: string) => void;
}

export function useSlotActions(slots?: Slots, updateSlots?: (slots: Slots) => void): [Slots, EditSlotsActions] {
  const [deckCardCounts, updateDeckCardCounts] = useSlots(slots || {}, updateSlots);

  const setSlot = useCallback((code: string, value: number) => {
    updateDeckCardCounts({ type: 'set-slot', code, value });
  }, [updateDeckCardCounts]);
  const incSlot = useCallback((code: string, max?: number) => {
    updateDeckCardCounts({ type: 'inc-slot', code, max });
  }, [updateDeckCardCounts]);
  const decSlot = useCallback((code: string) => {
    updateDeckCardCounts({ type: 'dec-slot', code });
  }, [updateDeckCardCounts]);
  const actions = useMemo(() => {
    return {
      setSlot,
      incSlot,
      decSlot,
    };
  }, [setSlot, incSlot, decSlot]);
  return [deckCardCounts, actions];
}

interface AppendCardsAction {
  type: 'cards';
  cards: Card[];
}

interface FetchCardsAction {
  type: 'fetch';
  fetching: string[];
}

type LoadCardsAction = ClearAction | AppendCardsAction | FetchCardsAction;

interface LazyCardsState {
  cards: CardsMap;
  fetching: Set<string>;
}

const EMPTY_SET = new Set<string>();
function lazyCardMap(indexBy: 'code' | 'id'): Reducer<LazyCardsState, LoadCardsAction> {
  return (state: LazyCardsState, action: LoadCardsAction): LazyCardsState => {
    switch (action.type) {
      case 'clear':
        return {
          cards: {},
          fetching: EMPTY_SET,
        };
      case 'cards': {
        const result: CardsMap = { ...state.cards };
        forEach(action.cards, card => {
          result[card[indexBy]] = card;
        });
        return {
          cards: result,
          fetching: state.fetching,
        };
      }
      case 'fetch':
        return {
          cards: state.cards,
          fetching: new Set([...state.fetching, ...action.fetching]),
        };
    }
  };
}

export function useCards(indexBy: 'code' | 'id', initialCards?: Card[]): [CardsMap, (action: LoadCardsAction) => void, Set<string>] {
  const [{ cards, fetching }, updateCards] = useReducer(
    lazyCardMap(indexBy),
    initialCards || null,
    (initialCards: Card[] | null) => {
      if (initialCards) {
        return lazyCardMap(indexBy)({
          cards: {},
          fetching: EMPTY_SET,
        }, {
          type: 'cards',
          cards: [...initialCards],
        });
      }
      return {
        cards: {},
        fetching: EMPTY_SET,
      };
    }
  );
  return [cards, updateCards, fetching];
}

export function useTabooSetId(tabooSetOverride?: number): number {
  const selector = useMemo(makeTabooSetSelector, []);
  return useSelector((state: AppState) => selector(state, tabooSetOverride)) || 0;
}

export function usePlayerCards(
  codes: string[],
  store: boolean,
  tabooSetOverride?: number,
): [CardsMap | undefined, boolean, boolean] {
  const tabooSetId = useTabooSetId(tabooSetOverride);
  const [cards, setCards] = useState<CardsMap>();
  const [loading, setLoading] = useState(true);
  const { getPlayerCards, getExistingCards } = useContext(PlayerCardContext);
  const previousTabooSetId = useRef<number | undefined>(tabooSetId);
  const currentCards = useRef<CardsMap>(cards ?? {});
  useEffect(() => {
    if (cards) {
      currentCards.current = cards;
    }
  }, [cards]);
  useEffect(() => {
    const knownCards: CardsMap = store ? getExistingCards(tabooSetId) : {};
    if (findIndex(codes, code => !knownCards[code]) === -1) {
      const cards: CardsMap = {};
      forEach(codes, code => {
        cards[code] = knownCards[code];
      });
      setCards(cards);
      setLoading(false);
      return;
    }

    const existingCards: CardsMap = {};
    let codesToFetch: string[] = [];
    if (previousTabooSetId.current === tabooSetId) {
      forEach(codes, code => {
        if (currentCards.current[code]) {
          existingCards[code] = currentCards.current[code];
        } else {
          codesToFetch.push(code);
        }
      })
    } else {
      codesToFetch = codes;
    }
    if (!codesToFetch.length) {
      setCards(existingCards);
      return;
    }
    let canceled = false;
    setLoading(true);
    getPlayerCards(codesToFetch, tabooSetId, store).then(cards => {
      if (!canceled) {
        previousTabooSetId.current = tabooSetId;
        setCards({
          ...cards,
          ...existingCards,
        });
        setLoading(false);
      }
    });
    return () => {
      canceled = true;
    };
  }, [tabooSetId, codes, store, getExistingCards, getPlayerCards, setLoading]);
  const cardsMissing = useMemo(() => {
    if (codes.length === 0) {
      return false;
    }
    return !cards || !!find(codes, code => !cards[code]);
  }, [cards, codes]);
  return [cards, loading, cardsMissing];
}

export function usePlayerCardsFunc(generator: () => string[], deps: any[], store: boolean, tabooSetOverride?: number) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const codes = useMemo(generator, deps);
  return usePlayerCards(codes, store, tabooSetOverride);
}

function deckToSlots(deck: LatestDeckT): string[] {
  return uniq([
    deck.investigator,
    ...(deck.deck.meta?.alternate_back ? [deck.deck.meta.alternate_back] : []),
    ...(deck.deck.meta?.alternate_front ? [deck.deck.meta.alternate_front] : []),
    ...keys(deck.deck.slots),
    ...keys(deck.deck.ignoreDeckLimitSlots),
    ...keys(deck.deck.sideSlots),
    ...(deck.previousDeck ? keys(deck.previousDeck.slots) : []),
    ...(deck.previousDeck ? keys(deck.previousDeck.ignoreDeckLimitSlots) : []),
    ...(deck.previousDeck ? keys(deck.previousDeck.sideSlots) : []),
  ]);
}

const EMPTY_CARD_LIST: string[] = [];
export function useLatestDeckCards(deck: LatestDeckT | undefined, store: boolean): [CardsMap | undefined, boolean, boolean] {
  return usePlayerCardsFunc(() => deck ? deckToSlots(deck) : EMPTY_CARD_LIST, [deck], store, deck?.deck.taboo_id);
}

export function useLatestDecksCards(decks: LatestDeckT[] | undefined, store: boolean, tabooSetId: number): [CardsMap | undefined, boolean, boolean] {
  return usePlayerCardsFunc(() => decks ? uniq(flatMap(decks, deckToSlots)) : EMPTY_CARD_LIST, [decks], store, tabooSetId);
}

export function useInvestigators(codes: string[], tabooSetOverride?: number): CardsMap | undefined {
  const [cards] = useCardMap(codes, 'player', true, tabooSetOverride)
  return cards;
}
export function useCopyAction(value: string, confirmationText: string): () => void {
  return useCallback(() => {
    Clipboard.setString(value);
    Navigation.showOverlay({
      component: {
        name: 'Toast',
        passProps: {
          message: confirmationText,
        },
        options: Toast.options,
      },
    });
  }, [value, confirmationText]);
}


export function useSettingValue(setting: MiscSetting): boolean {
  return useSelector((state: AppState) => {
    switch (setting) {
      case 'alphabetize': return !!state.settings.alphabetizeEncounterSets;
      case 'beta1': return !!state.settings.beta1;
      case 'colorblind': return !!state.settings.colorblind;
      case 'ignore_collection': return !!state.settings.ignore_collection;
      case 'justify': return !!state.settings.justifyContent;
      case 'single_card': return !!state.settings.singleCardView;
      case 'sort_quotes': return !!state.settings.sortRespectQuotes;
      case 'custom_content': return !!state.settings.customContent;
      case 'campaign_show_deck_id': return !!state.settings.campaignShowDeckId;

      case 'card_grid': return !!state.settings.cardGrid;
      case 'draft_grid': return !state.settings.draftList;
      case 'map_list': return !!state.settings.mapList;
      case 'draft_from_collection': return !state.settings.draftSeparatePacks;

      case 'hide_campaign_decks': return !!state.settings.hideCampaignDecks;
      case 'hide_arkhamdb_decks': return !!state.settings.hideArkhamDbDecks;
      case 'android_one_ui_fix': return !!state.settings.androidOneUiFix;
      case 'low_memory':
        return Platform.OS === 'android' || !!state.settings.lowMemory;
      case 'search_english':
        return !!state.settings.searchEnglish;
    }
  });
}

export function useSettingFlag(setting: MiscLocalSetting): [boolean, (value: boolean) => void] {
  const actualValue = useSettingValue(setting);
  const dispatch = useDispatch();
  const [value, setValue] = useState(actualValue);
  useEffect(() => {
    setValue(actualValue);
  }, [actualValue, setValue]);

  const actuallySetValue = useCallback((value: boolean) => {
    setValue(value);
    setTimeout(() => {
      dispatch(setMiscSetting(setting, value));
    }, 50);
  }, [setting, setValue, dispatch]);
  return [value, actuallySetValue];
}


export function useRemoteSettingFlag(
  setting: MiscRemoteSetting,
  remoteUpdate: (setting: MiscRemoteSetting, value: boolean) => void
): [boolean, (value: boolean) => void] {
  const actualValue = useSettingValue(setting);
  const dispatch = useDispatch();
  const [value, setValue] = useState(actualValue);
  useEffect(() => {
    setValue(actualValue);
  }, [actualValue, setValue]);

  const actuallySetValue = useCallback((value: boolean) => {
    setValue(value);
    remoteUpdate(setting, value);
    setTimeout(() => {
      dispatch(setMiscSetting(setting, value));
    }, 50);
  }, [setting, setValue, dispatch, remoteUpdate]);
  return [value, actuallySetValue];
}

export function useAllInvestigators(
  tabooSetOverride?: number,
  sortType?: SortType[]
): [Card[], boolean] {
  const customContent = useSettingValue('custom_content');
  const sort = useMemo(() => sortType ? Card.querySort(true, sortType) : undefined, [sortType]);
  const query = useMemo(() => {
    if (!customContent) {
      return combineQueries(INVESTIGATOR_CARDS_QUERY, [NO_CUSTOM_CARDS_QUERY], 'and');
    }
    return INVESTIGATOR_CARDS_QUERY;
  }, [customContent]);
  return useCardsFromQuery({ query, sort, tabooSetOverride });
}

export function useParallelInvestigator(investigatorCode?: string, tabooSetOverride?: number): [Card[], boolean] {
  const query = useMemo(() => investigatorCode ? where('c.alternate_of_code = :investigatorCode', { investigatorCode }) : undefined, [investigatorCode]);
  const [cards, loading] = useCardsFromQuery({ query, tabooSetOverride });
  const { storePlayerCards } = useContext(PlayerCardContext);
  useEffect(() => {
    if (cards.length) {
      storePlayerCards(cards);
    }
  }, [cards, storePlayerCards]);
  return [cards, loading];
}

export function useParallelInvestigators(codes?: string[], tabooSetOverride?: number): [Card[], boolean] {
  const query = useMemo(() => codes ? where('c.alternate_of_code in (:...codes)', { codes }) : undefined, [codes]);
  const [cards, loading] = useCardsFromQuery({ query, tabooSetOverride });
  const { storePlayerCards } = useContext(PlayerCardContext);
  useEffect(() => {
    if (cards.length) {
      storePlayerCards(cards);
    }
  }, [cards, storePlayerCards]);
  return [cards, loading];
}

export function useRequiredCards(investigator?: InvestigatorChoice, tabooSetOverride?: number): [Card[], boolean] {
  const [codes, loading] = useMemo(() => {
    if (!investigator?.front || !investigator?.back) {
      return [[], true];
    }
    return [
      uniq([
        ...flatMap(investigator.back.deck_requirements?.card || [], req => [
          ...(req.code ? [req.code] : []),
          ...(req.alternates || []),
        ]),
        ...(specialCards[investigator.front.code]?.front?.codes || []),
        ...(specialCards[investigator.back.code]?.back?.codes || []),
      ]),
      false,
    ];
  }, [investigator]);
  const query = useMemo(() => codes?.length ? where('c.code in (:...codes)', { codes }) : undefined, [codes]);
  const [cards, cardsLoading] = useCardsFromQuery({ query, tabooSetOverride });
  const { storePlayerCards } = useContext(PlayerCardContext);
  useEffect(() => {
    if (cards.length) {
      storePlayerCards(cards);
    }
  }, [cards, storePlayerCards]);
  return [cards, loading || cardsLoading];
}

export function useTabooSet(tabooSetId: number): TabooSet | undefined {
  const { tabooSets } = useContext(DatabaseContext);
  return find(tabooSets, tabooSet => tabooSet.id === tabooSetId);
}

export function useWeaknessCards(includeRandomBasicWeakness?: boolean, tabooSetOverride?: number): CardsMap | undefined {
  const tabooSetSelector = useMemo(makeTabooSetSelector, []);
  const tabooSetId = useSelector((state: AppState) => tabooSetSelector(state, tabooSetOverride));
  const { playerCardsByTaboo } = useContext(DatabaseContext);
  const playerCards = playerCardsByTaboo && playerCardsByTaboo[`${tabooSetId || 0}`];
  const weaknessCards = playerCards?.weaknessCards;
  return useMemo(() => {
    if (!weaknessCards) {
      return undefined;
    }
    const result: CardsMap = {};
    forEach(weaknessCards, (card, code) => {
      if (card && (includeRandomBasicWeakness || code !== RANDOM_BASIC_WEAKNESS)) {
        result[code] = card;
      }
    });
    return result;
  }, [includeRandomBasicWeakness, weaknessCards]);
}

export function useCycleScenarios(cycleCode: CampaignCycleCode | undefined): Scenario[] {
  return useMemo(() => cycleCode ? campaignScenarios(cycleCode) : [], [cycleCode]);
}

export function useCampaignScenarios(campaign: SingleCampaignT | undefined): [Scenario[], { [code: string]: Scenario }] {
  const cycleScenarios = useCycleScenarios(campaign?.cycleCode);
  const scenarioByCode = useMemo(() => {
    const result: { [code: string]: Scenario } = {};
    forEach(cycleScenarios, scenario => {
      result[scenario.code] = scenario;
    });
    return result;
  }, [cycleScenarios]);
  return [cycleScenarios, scenarioByCode];
}

export function useDeckWithFetch(id: DeckId | undefined, actions: DeckActions): LatestDeckT | undefined {
  const deck = useDeck(id, true);
  const dispatch = useAppDispatch();
  const { userId } = useContext(ArkhamCardsAuthContext);
  useEffect(() => {
    if (!deck && id !== undefined && !id.local && !id.serverId) {
      dispatch(fetchPrivateDeck(userId, actions, id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!deck?.previousDeck && deck?.deck.previousDeckId && !deck.deck.local && !deck.deck.previousDeckId.local && !deck.deck.previousDeckId.serverId) {
      dispatch(fetchPrivateDeck(userId, actions, deck.deck.previousDeckId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);
  return deck;
}


export function useEffectUpdate(update: () => void, deps: any[]) {
  const firstUpdate = useRef(true);
  useEffect(() => {
    if (firstUpdate.current) {
      firstUpdate.current = false;
      return;
    }
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function usePressCallback(callback: undefined | (() => void), bufferTime: number = 1000): undefined | (() => void) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  const onPress = useMemo(() => {
    return debounce(() => callbackRef.current && callbackRef.current(), bufferTime, { leading: true, trailing: false });
  }, [callbackRef, bufferTime]);
  return callback ? onPress : undefined;
}

export function useInterval(callback: () => void, delay: number) {
  const savedCallback = useRef<() => void>(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!delay) {
      return;
    }
    if (savedCallback.current) {
      const id = setInterval(savedCallback.current, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

/*
export function useWhyDidYouUpdate<T>(name: string, props: T) {
  // Get a mutable ref object where we can store props ...
  // ... for comparison next time this hook runs.
  const previousProps = useRef<T>();

  useEffect(() => {
    if (previousProps.current) {
      // Get all keys from previous and current props
      const allKeys = Object.keys({ ...previousProps.current, ...props });
      // Use this object to keep track of changed props
      const changesObj = {};
      // Iterate through keys
      allKeys.forEach(key => {
        // If previous is different from current
        if (previousProps.current[key] !== props[key]) {
          // Add to changesObj
          changesObj[key] = {
            from: previousProps.current[key],
            to: props[key],
          };
        }
      });

      // If changesObj not empty then output to console
      if (Object.keys(changesObj).length) {
        console.log('[why-did-you-update]', name, changesObj);
      }
    }

    // Finally update previousProps with current props for next hook call
    previousProps.current = props;
  });
}*/
