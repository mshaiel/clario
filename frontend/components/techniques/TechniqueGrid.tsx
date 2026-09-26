import React from 'react';
import { FlatList, View, ListRenderItem } from 'react-native';
import { TechniqueCard } from './TechniqueCard';
import { TechniqueGuide } from '@/lib/techniqueData';

interface Props {
  techniques: TechniqueGuide[];
  onPress: (technique: TechniqueGuide) => void;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  isReviewed?: (id: string) => boolean;
}

export function TechniqueGrid({ techniques, onPress, ListHeaderComponent, ListEmptyComponent, isReviewed }: Props) {
  const renderItem: ListRenderItem<TechniqueGuide> = ({ item, index }) => (
    <TechniqueCard
      technique={item}
      index={index}
      onPress={() => onPress(item)}
      reviewed={isReviewed ? isReviewed(item.id) : false}
    />
  );

  return (
    <FlatList
      data={techniques}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      numColumns={1}
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={() => <View style={{ height: 12, marginHorizontal: 24 }} />}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={<View style={{ height: 40 }} />}
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      windowSize={7}
    />
  );
}