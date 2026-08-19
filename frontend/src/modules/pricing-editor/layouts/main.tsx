import PropTypes from 'prop-types';

export default function Main({ children, className = '', ...other }: { children: React.ReactNode; className?: string }) {

  return (
    <main
      className={`flex min-h-0 min-w-0 flex-1 ${className}`}
      {...other}
    >
      {children}
    </main>
  );
}

Main.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string,
};
