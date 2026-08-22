import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Telegram } from 'ziro-relay';

import { useRelay } from '../hooks/useRelay';
import { USE_FAKE_ENGINE } from '../native/relayClient';

/**
 * BASELINE - developer B owns and grows this. Owner: developer B.
 *
 * The smallest thing that renders the contract: node status, peer count, received list,
 * one send button. It exists so the app runs in Expo Go on day one, not as the final UI.
 */
export function HomeScreen() {
  const { status, telegrams, peerCount, lastReject, start, sendTest } = useRelay();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ZIRO</Text>
      {USE_FAKE_ENGINE ? <Text style={styles.badge}>FAKE ENGINE</Text> : null}

      <Text>Node: {status}</Text>
      <Text>Peers connected: {peerCount}</Text>
      {lastReject ? <Text style={styles.reject}>Last rejected: {lastReject}</Text> : null}

      <Pressable style={styles.button} onPress={() => void start()}>
        <Text style={styles.buttonText}>Activate emergency mode</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => void sendTest()}>
        <Text style={styles.buttonText}>Send test telegram</Text>
      </Pressable>

      <FlatList
        data={telegrams}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text>No telegrams yet</Text>}
        renderItem={({ item }) => <TelegramCard telegram={item} />}
      />
    </View>
  );
}

function TelegramCard({ telegram }: { telegram: Telegram }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {telegram.vital?.name ?? telegram.user_id} - {telegram.status}
      </Text>
      <Text>
        hop {telegram.hop} / ttl {telegram.ttl} - severity {telegram.severity}
      </Text>
      {telegram.vital ? (
        <Text>
          blood {telegram.vital.blood ?? '?'} - allergies{' '}
          {telegram.vital.allergies.join(', ') || 'none'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' },
  badge: { color: '#b45309', fontWeight: '600' },
  reject: { color: '#b91c1c' },
  button: { backgroundColor: '#1f2937', padding: 12, borderRadius: 8 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '600' },
  card: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  cardTitle: { fontWeight: '600' },
});
