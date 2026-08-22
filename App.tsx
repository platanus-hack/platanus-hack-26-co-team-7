import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { HomeScreen } from './src/screens/HomeScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <HomeScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
