import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// App de teste manual das features do My DevTools (não é o app final). Cada
// feature nova ganha sua própria página aqui, com botões que descrevem o que
// testam — a página some quando a feature correspondente sai do roadmap ou
// vira redundante.

function HomeScreen({ onSelect }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My DevTools — páginas de teste</Text>
      <Pressable style={styles.button} onPress={() => onSelect('console')}>
        <Text style={styles.buttonText}>Console (log / warn / error / exceção)</Text>
      </Pressable>
    </View>
  );
}

function BackButton({ onPress }) {
  return (
    <Pressable style={styles.backButton} onPress={onPress}>
      <Text style={styles.buttonText}>{'< Voltar'}</Text>
    </Pressable>
  );
}

function ConsoleScreen({ onBack }) {
  let count = 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Teste: Console</Text>

      <Pressable
        style={styles.button}
        onPress={() => console.log(`log #${++count} às ${new Date().toLocaleTimeString()}`)}
      >
        <Text style={styles.buttonText}>console.log</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={() => console.warn(`warn #${++count}`)}>
        <Text style={styles.buttonText}>console.warn</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={() => console.error(`error #${++count}`)}>
        <Text style={styles.buttonText}>console.error</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => {
          throw new Error(`exceção não tratada #${++count}`);
        }}
      >
        <Text style={styles.buttonText}>throw (exceção)</Text>
      </Pressable>

      <BackButton onPress={onBack} />
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState('home');

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {screen === 'home' && <HomeScreen onSelect={setScreen} />}
      {screen === 'console' && <ConsoleScreen onBack={() => setScreen('home')} />}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 48,
  },
  title: {
    marginBottom: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 6,
    backgroundColor: '#e4e4e7',
  },
  backButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 6,
    backgroundColor: '#d4d4d8',
  },
  buttonText: {
    fontSize: 14,
  },
});
