import React, { useCallback, useContext, useEffect } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { find, last } from 'lodash';
import { Navigation } from 'react-native-navigation';
import { t } from 'ttag';
import KeepAwake from 'react-native-keep-awake';

import { iconsMap } from '@app/NavIcons';
import COLORS from '@styles/colors';
import CampaignGuideContext from './CampaignGuideContext';
import StepsComponent from './StepsComponent';
import { NavigationProps } from '@components/nav/types';
import { ScenarioFaqProps } from '@components/campaignguide/ScenarioFaqView';
import { useNavigationButtonPressed } from '@components/core/hooks';
import StyleContext from '@styles/StyleContext';
import NarrationWrapper, { NarrationTrack, setNarrationQueue } from '@components/campaignguide/NarrationWrapper';
import ScenarioStep from '@data/scenario/ScenarioStep';
import ScenarioGuideContext from './ScenarioGuideContext';
import { ProcessedScenario } from '@data/scenario';
import ScenarioStateHelper from '@data/scenario/ScenarioStateHelper';
import { showGuideCampaignLog } from '@components/campaign/nav';
import ArkhamButton from '@components/core/ArkhamButton';
import { CustomData, Narration } from '@data/scenario/types';
import LanguageContext from '@lib/i18n/LanguageContext';
import { useAudioAccess } from '@lib/audio/narrationPlayer';

interface ScenarioProps {
  standalone: boolean;
  showLinkedScenario?: (
    scenarioId: string
  ) => void;
  footer?: React.ReactNode;
}
type Props = NavigationProps & ScenarioProps;

export function getDownloadLink(lang: string, customData?: CustomData) {
  if (!customData?.download_link) {
    return undefined;
  }
  switch (lang) {
    case 'ko':
    case 'en':
    case 'zh':
    case 'zh-cn':
    case 'fr':
    case 'es':
    case 'pt':
    case 'uk':
    case 'de':
    case 'it':
    case 'ru':
    case 'vi':
    case 'pl':
      return customData.download_link[lang] || customData.download_link.en;
    default:
      return customData.download_link.en;
  }
}

function hasNarrationAccess(narration: Narration, narrationLangs: string[]): string | undefined {
  const set = new Set(narrationLangs);
  // Not every entry has a 'DissonantVoices' one present, due to some missing entries, sometimes in the original.
  return find(narration.lang, lang => set.has(lang));
}

function getNarrationQueue(processedScenario: ProcessedScenario, scenarioState: ScenarioStateHelper, narrationLangs: string[]) {
  const campaignCode = processedScenario.scenarioGuide.campaignGuide.campaignCycleCode();
  const campaignName = processedScenario.scenarioGuide.campaignGuide.campaignName();
  const scenarioName = processedScenario.scenarioGuide.scenarioName();

  const queue: NarrationTrack[] = [];
  const scenarioSteps: ScenarioStep[] = [];
  for (const scenarioStep of processedScenario.steps) {
    if (scenarioStep.step.type === 'effects') {
      for (const effectsWithInput of scenarioStep.step.effectsWithInput) {
        for (const effect of effectsWithInput.effects) {
          if (effect.type === 'story_step' && effect.steps) {
            scenarioSteps.push(...processedScenario.scenarioGuide.expandSteps(
              effect.steps,
              scenarioState,
              scenarioStep.campaignLog
            ));
          }
        }
      }
    } else {
      scenarioSteps.push(scenarioStep);
    }
  }
  for (const scenarioStep of scenarioSteps) {
    switch(scenarioStep.step.type) {
      case 'resolution': {
        const narration = processedScenario.scenarioGuide.resolution(
          scenarioStep.step.resolution
        )?.narration;
        const lang = narration ? hasNarrationAccess(narration, narrationLangs) : undefined;
        if (narration && lang) {
          queue.push({
            ...narration,
            campaignCode,
            campaignName,
            scenarioName,
            lang,
          });
        }
        break;
      }
      default: {
        const narration = scenarioStep.step.narration;
        const lang = narration ? hasNarrationAccess(narration, narrationLangs) : undefined;
        if (narration && lang) {
          queue.push({
            ...narration,
            campaignCode,
            campaignName,
            scenarioName,
            lang,
          });
        }
      }
    }
  }
  return queue;
}

export function dynamicOptions(undo: boolean) {
  const rightButtons = [{
    icon: iconsMap.log,
    id: 'log',
    color: COLORS.M,
    accessibilityLabel: t`Campaign Log`,
  }];
  if (undo) {
    rightButtons.push({
      icon: iconsMap.undo,
      id: 'undo',
      color: COLORS.M,
      accessibilityLabel: t`Undo`,
    });
  }
  return {
    topBar: {
      rightButtons,
    },
  };
}


export default function ScenarioComponent({ componentId, showLinkedScenario, standalone, footer }: Props) {
  const { campaignState, campaignId } = useContext(CampaignGuideContext);
  const { processedScenario, processedCampaign, scenarioState } = useContext(ScenarioGuideContext);
  const { backgroundStyle, width } = useContext(StyleContext);
  const { lang } = useContext(LanguageContext);
  const scenarioId = processedScenario.id.encodedScenarioId;
  useEffect(() => {
    if (standalone && processedScenario.type !== 'started' && processedScenario.type !== 'completed') {
      campaignState.startScenario(scenarioId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    Navigation.mergeOptions(componentId, dynamicOptions(processedScenario.canUndo));
  }, [componentId, processedScenario.canUndo]);

  const menuPressed = useCallback(() => {
    const log = last(processedScenario.steps);
    if (!log) {
      return;
    }
    showGuideCampaignLog(
      componentId,
      campaignId,
      processedScenario.scenarioGuide.campaignGuide,
      log.campaignLog,
      { standalone },
      scenarioId,
      processedCampaign
    );
  }, [componentId, processedCampaign, processedScenario, campaignId, scenarioId, standalone]);

  const resetPressed = useCallback(() => {
    Alert.alert(
      t`Reset Scenario?`,
      t`Are you sure you want to reset this scenario?\n\nAll data you have entered will be lost.`,
      [{
        text: t`Nevermind`,
      }, {
        text: t`Reset`,
        style: 'destructive',
        onPress: () => {
          campaignState.resetScenario(scenarioId);
        },
      }]
    );
  }, [campaignState, scenarioId]);

  const undoPressed = useCallback(() => {
    campaignState.undo(scenarioId);
    if (processedScenario.closeOnUndo) {
      Navigation.pop(componentId);
    }
  }, [componentId, scenarioId, processedScenario.closeOnUndo, campaignState]);

  useNavigationButtonPressed(({ buttonId }) => {
    switch (buttonId) {
      case 'reset': {
        resetPressed();
        break;
      }
      case 'log': {
        menuPressed();
        break;
      }
      case 'undo': {
        undoPressed();
        break;
      }
    }
  }, componentId, [resetPressed, menuPressed, undoPressed], 100);


  const switchCampaignScenario = useCallback(() => {
    Navigation.pop(componentId).then(() => {
      if (showLinkedScenario) {
        showLinkedScenario(processedScenario.id.encodedScenarioId);
      }
    });
  }, [componentId, showLinkedScenario, processedScenario.id]);

  const showScenarioFaq = useCallback(() => {
    Navigation.push<ScenarioFaqProps>(componentId, {
      component: {
        name: 'Guide.ScenarioFaq',
        passProps: {
          scenario: processedScenario.id.scenarioId,
          campaignId,
        },
      },
    });
  }, [componentId, campaignId, processedScenario.id]);
  const [hasAudio, narrationLangs] = useAudioAccess()

  useEffect(() => {
    if (!hasAudio) {
      return;
    }
    const queue = getNarrationQueue(processedScenario, scenarioState, narrationLangs);
    setNarrationQueue(queue);
  }, [processedScenario, scenarioState, hasAudio, narrationLangs]);

  const hasInterludeFaq = processedScenario.scenarioGuide.scenarioType() !== 'scenario' &&
    processedScenario.scenarioGuide.campaignGuide.scenarioFaq(processedScenario.id.scenarioId).length;
  const customData = processedScenario.scenarioGuide.scenarioCustomData();
  const downloadPressed = useCallback(() => {
    const link = getDownloadLink(lang, customData);
    if (link) {
      Linking.openURL(link);
    }
  }, [customData, lang]);
  return (
    <KeyboardAvoidingView
      style={[styles.keyboardView, backgroundStyle]}
      behavior="position"
      enabled
      keyboardVerticalOffset={100}
    >
      <KeepAwake />
      <NarrationWrapper>
        <ScrollView contentContainerStyle={backgroundStyle} keyboardShouldPersistTaps="always">
          { !!customData && <ArkhamButton icon="world" title={t`Download print and play cards`} onPress={downloadPressed} /> }
          { !!hasInterludeFaq && (
            <ArkhamButton icon="faq" title={t`Interlude FAQ`} onPress={showScenarioFaq} />
          ) }
          <StepsComponent
            componentId={componentId}
            width={width}
            steps={processedScenario.steps}
            switchCampaignScenario={switchCampaignScenario}
          />
          { !!footer ? footer : <View style={{ height: 100 }} /> }
        </ScrollView>
      </NarrationWrapper>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
});
