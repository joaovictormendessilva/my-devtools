import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// App de teste manual do painel Console do My DevTools (não é o app final —
// só serve pra gerar console.log/warn/error/exceção sob demanda e ver se
// aparecem ao vivo no painel).
export default function App() {
  let count = 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My DevTools — teste de Console</Text>

      <Pressable
        style={styles.button}
        onPress={() => console.log(`log #${++count} às ${new Date().toLocaleTimeString()}`)}
      >
        <Text style={styles.buttonText}>console.log</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => console.warn(`warn #${++count}`)}
      >
        <Text style={styles.buttonText}>console.warn</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => console.error(`error #${++count}`)}
      >
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

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
  buttonText: {
    fontSize: 14,
  },
});
