/** The greeting of the project list by the time of day (spec 36c): until 11 the morning, from 18 the evening. */
export function greetingKey(hour: number) {
  if (hour < 11) return 'projects.greeting.morning' as const;
  if (hour >= 18) return 'projects.greeting.evening' as const;
  return 'projects.greeting.day' as const;
}
