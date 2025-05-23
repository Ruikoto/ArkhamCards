import React, { useCallback, useContext } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { find, filter, map } from 'lodash';
import { t } from 'ttag';

import NonDeckDetailsButton from './NonDeckDetailsButton';
import UpgradeDeckButton from './UpgradeDeckButton';
import { Deck, getDeckId, ParsedDeck } from '@actions/types';
import InvestigatorRow from '@components/core/InvestigatorRow';
import { CardsMap } from '@data/types/Card';
import { parseBasicDeck } from '@lib/parseDeck';
import LegacyDeckRow from '@components/campaign/LegacyDeckRow';
import { s } from '@styles/space';
import StyleContext from '@styles/StyleContext';
import { useToggles } from '@components/core/hooks';
import LatestDeckT from '@data/interfaces/LatestDeckT';
import SingleCampaignT from '@data/interfaces/SingleCampaignT';
import LoadingCardSearchResult from '@components/cardlist/LoadingCardSearchResult';
import LanguageContext from '@lib/i18n/LanguageContext';
import { CampaignInvestigator } from '@data/scenario/GuidedCampaignLog';

interface Props {
  lang: string;
  showDeckUpgradeDialog: (deck: Deck, investigator?: CampaignInvestigator) => void;
  updateInvestigatorXp: (investigator: CampaignInvestigator, xp: number) => void;
  campaign: SingleCampaignT;
  originalDeckUuids: Set<string>;
  decks: LatestDeckT[];
  allInvestigators?: CampaignInvestigator[];
}

function experienceLine(deck: Deck, parsedDeck: ParsedDeck) {
  const xp = (deck.xp || 0) + (deck.xp_adjustment || 0);
  if (xp > 0) {
    if (parsedDeck.changes && parsedDeck.changes.spentXp > 0) {
      return t`${xp} available experience, (${parsedDeck.changes.spentXp} spent)`;
    }
    return t`${xp} available experience`;
  }
  const totalXp = parsedDeck.experience || 0;
  return t`${totalXp} total`;
}

export default function UpgradeDecksList({
  lang,
  showDeckUpgradeDialog,
  updateInvestigatorXp,
  campaign,
  originalDeckUuids,
  decks,
  allInvestigators,
}: Props) {
  const { typography } = useContext(StyleContext);
  const [saved, , setSaved] = useToggles({});
  const { listSeperator } = useContext(LanguageContext);
  const renderDetails = useCallback((
    deck: Deck,
    cards: CardsMap,
    investigator: CampaignInvestigator,
    previousDeck?: Deck
  ) => {
    if (!deck) {
      return null;
    }
    const eliminated = investigator.card.eliminated(campaign.investigatorData?.[investigator.code]);
    if (eliminated) {
      return null;
    }
    if (!originalDeckUuids.has(getDeckId(deck).uuid)) {
      const parsedDeck = parseBasicDeck(deck, cards, listSeperator, previousDeck);
      if (!parsedDeck?.deck) {
        return null;
      }
      return (
        <View style={styles.section}>
          <View style={styles.column}>
            <Text style={typography.text}>
              { experienceLine(parsedDeck.deck, parsedDeck) }
            </Text>
          </View>
        </View>
      );
    }

    return (
      <UpgradeDeckButton
        deck={deck}
        investigator={investigator}
        onPress={showDeckUpgradeDialog}
      />
    );
  }, [campaign.investigatorData, originalDeckUuids, typography, listSeperator, showDeckUpgradeDialog]);

  const saveXp = useCallback((investigator: CampaignInvestigator, xp: number) => {
    updateInvestigatorXp(investigator, xp);
    setSaved(investigator.code, true);
  }, [updateInvestigatorXp, setSaved]);

  const investigators = filter(
    allInvestigators,
    investigator => !investigator.card.eliminated(campaign.investigatorData?.[investigator.code] || {})
  );
  if (allInvestigators === undefined) {
    return <LoadingCardSearchResult noBorder />;
  }
  return (
    <>
      { map(investigators, investigator => {
        const deck = find(decks, deck => deck.investigator === investigator.code);
        if (deck) {
          return (
            <LegacyDeckRow
              key={deck.id.local ? deck.id.uuid : deck.id.id}
              lang={lang}
              investigator={investigator}
              campaign={campaign}
              deck={deck}
              renderDetails={renderDetails}
              compact
              viewDeckButton
            />
          );
        }
        return (
          <InvestigatorRow
            key={investigator.code}
            investigator={investigator}
          >
            <NonDeckDetailsButton
              investigator={investigator}
              saved={saved[investigator.code] || false}
              saveXp={saveXp}
            />
          </InvestigatorRow>
        );
      }) }
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: s,
    marginRight: s,
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column',
  },
});
