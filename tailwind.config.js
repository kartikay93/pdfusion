/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        body: ['"Inter"', 'sans-serif']
      },
      colors: {
        ink: '#1B2027',
        paper: '#F6F5F2',
        slate: {
          850: '#232933'
        },
        indigo: {
          650: '#3F4FDB'
        },
        blossom: {
          50: '#FFF4F8',
          100: '#FFE3ED',
          200: '#FFC7DB',
          400: '#FF8FB3',
          500: '#F2679A',
          600: '#D14E80',
          900: '#5C1F38'
        }
      },
      borderRadius: {
        xl2: '1.25rem'
      },
      boxShadow: {
        soft: '0 1px 2px rgba(27,32,39,.04), 0 8px 24px rgba(27,32,39,.08)'
      }
    }
  },
  plugins: []
};
